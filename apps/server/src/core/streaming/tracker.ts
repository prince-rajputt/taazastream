import { createHash, randomUUID } from 'node:crypto';
import type {
  ActiveStream,
  DeviceInfo,
  DeviceType,
  PlaybackMode,
  QualityId,
} from '@taazastream/shared';

/**
 * Fallback for players that send no heartbeat (e.g. VLC on the direct URL): a stream counts
 * as playing while it saw traffic within this window. Traffic alone is not enough for the web
 * player — browsers buffer short videos completely, then stay silent while still playing.
 */
const ACTIVE_WINDOW_MS = 20_000;
/** The web player reports every 10 s while playing; allow a couple of missed reports. */
const PLAYER_WINDOW_MS = 30_000;
/** A paused video stays listed this long after its last report. */
const PAUSED_WINDOW_MS = 10 * 60_000;
/** Ended streams are kept this long so a late heartbeat can revive them. */
const FORGET_MS = 15 * 60_000;
/** A device counts as connected while it made any request within this window. */
const DEVICE_WINDOW_MS = 3 * 60_000;
const BANDWIDTH_WINDOW_MS = 5_000;

interface Sample {
  t: number;
  bytes: number;
}

class RateMeter {
  private samples: Sample[] = [];
  total = 0;

  add(bytes: number, now = Date.now()) {
    this.total += bytes;
    const last = this.samples[this.samples.length - 1];
    // Bucket per 250ms to keep memory bounded under heavy streaming.
    if (last && now - last.t < 250) last.bytes += bytes;
    else this.samples.push({ t: now, bytes });
    this.trim(now);
  }

  private trim(now: number) {
    const cutoff = now - BANDWIDTH_WINDOW_MS;
    while (this.samples.length && this.samples[0]!.t < cutoff) this.samples.shift();
  }

  /** bits per second over the window */
  rate(now = Date.now()): number {
    this.trim(now);
    const bytes = this.samples.reduce((s, x) => s + x.bytes, 0);
    return (bytes * 8) / (BANDWIDTH_WINDOW_MS / 1000);
  }
}

interface StreamState {
  id: string;
  key: string;
  videoId: string;
  title: string;
  ip: string;
  deviceId: string;
  mode: PlaybackMode;
  quality: QualityId;
  startedAt: number;
  /** Last byte/segment/playlist request. */
  lastActivity: number;
  /** Last player heartbeat (0 = this player never sent one). */
  playerSeen: number;
  playerState: PlayerState;
  /** Whether a 'start' event has been emitted without a matching 'stop'. */
  live: boolean;
  meter: RateMeter;
}

type PlayerState = 'playing' | 'paused' | 'stopped';

interface DeviceState {
  id: string;
  ip: string;
  type: DeviceType;
  browser: string;
  os: string;
  firstSeen: number;
  lastSeen: number;
  meter: RateMeter;
}

export function classifyUserAgent(ua: string | undefined): {
  type: DeviceType;
  browser: string;
  os: string;
} {
  const s = ua ?? '';
  let type: DeviceType = 'Unknown';
  if (
    /smart-?tv|smarttv|tizen|web0s|webos|netcast|bravia|hbbtv|aft[a-z]|crkey|android tv|googletv|roku|appletv|philipstv|viera|vidaa/i.test(
      s,
    )
  )
    type = 'TV';
  else if (
    /ipad|tablet|kindle|silk|playbook/i.test(s) ||
    (/android/i.test(s) && !/mobile/i.test(s))
  )
    type = 'Tablet';
  else if (/iphone|ipod|android.*mobile|windows phone|mobile/i.test(s)) type = 'Phone';
  else if (/windows|macintosh|linux|cros/i.test(s)) type = 'Desktop';

  const browser = /edg\//i.test(s)
    ? 'Edge'
    : /opr\/|opera/i.test(s)
      ? 'Opera'
      : /samsungbrowser/i.test(s)
        ? 'Samsung Internet'
        : /firefox|fxios/i.test(s)
          ? 'Firefox'
          : /chrome|crios/i.test(s)
            ? 'Chrome'
            : /safari/i.test(s)
              ? 'Safari'
              : 'Browser';
  const os = /windows/i.test(s)
    ? 'Windows'
    : /iphone|ipad|ipod/i.test(s)
      ? 'iOS'
      : /android/i.test(s)
        ? 'Android'
        : /mac os/i.test(s)
          ? 'macOS'
          : /tizen/i.test(s)
            ? 'Tizen'
            : /web0s|webos/i.test(s)
              ? 'webOS'
              : /cros/i.test(s)
                ? 'ChromeOS'
                : /linux/i.test(s)
                  ? 'Linux'
                  : 'Unknown';
  return { type, browser, os };
}

/**
 * Tracks connected devices, active streams and bandwidth — in memory only.
 * Only the IP address and a coarse device class are kept (no personal data).
 */
export class StreamTracker {
  private devices = new Map<string, DeviceState>();
  private streams = new Map<string, StreamState>();
  private global = new RateMeter();
  private history: { t: number; bps: number }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<
    (
      event: 'start' | 'stop',
      s: { ip: string; videoId: string; title: string; mode: PlaybackMode },
    ) => void
  >();

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 2_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onStreamEvent(
    fn: (
      event: 'start' | 'stop',
      s: { ip: string; videoId: string; title: string; mode: PlaybackMode },
    ) => void,
  ) {
    this.listeners.add(fn);
  }

  private emit(event: 'start' | 'stop', s: StreamState) {
    s.live = event === 'start';
    for (const fn of this.listeners) fn(event, s);
  }

  /**
   * What the viewer is doing right now. The player's own heartbeat wins; raw traffic only
   * decides for players that never send one, or when traffic resumed after the last report.
   */
  private stateOf(s: StreamState, now: number): 'playing' | 'paused' | null {
    const traffic = now - s.lastActivity <= ACTIVE_WINDOW_MS;
    if (!s.playerSeen) return traffic ? 'playing' : null;
    const age = now - s.playerSeen;
    // Browsers keep buffering while paused, so traffic does not override a pause.
    if (s.playerState === 'paused' && age <= PAUSED_WINDOW_MS) return 'paused';
    if (s.playerState === 'playing' && age <= PLAYER_WINDOW_MS) return 'playing';
    // Stopped, or the heartbeat went quiet (tab crashed, Wi-Fi lost): only newer traffic counts.
    return traffic && s.lastActivity > s.playerSeen ? 'playing' : null;
  }

  private tick() {
    const now = Date.now();
    this.history.push({ t: now, bps: this.global.rate(now) });
    if (this.history.length > 90) this.history.shift(); // ~3 minutes
    for (const [key, s] of this.streams) {
      const state = this.stateOf(s, now);
      if (!state && s.live) this.emit('stop', s);
      if (!state && now - Math.max(s.lastActivity, s.playerSeen) > FORGET_MS)
        this.streams.delete(key);
    }
    for (const [id, d] of this.devices) {
      if (now - d.lastSeen > DEVICE_WINDOW_MS * 10) this.devices.delete(id);
    }
  }

  deviceIdFor(ip: string, ua: string | undefined): string {
    return createHash('sha1')
      .update(`${normalizeIp(ip)}|${ua ?? ''}`)
      .digest('hex')
      .slice(0, 16);
  }

  touchDevice(ip: string, ua: string | undefined): string {
    const id = this.deviceIdFor(ip, ua);
    const now = Date.now();
    const d = this.devices.get(id);
    if (d) d.lastSeen = now;
    else {
      const c = classifyUserAgent(ua);
      this.devices.set(id, {
        id,
        ip: normalizeIp(ip),
        ...c,
        firstSeen: now,
        lastSeen: now,
        meter: new RateMeter(),
      });
    }
    return id;
  }

  /** Streams that are playing right now (paused ones don't hold a slot), for limit checks. */
  activeCount(excludeKey?: string): number {
    const now = Date.now();
    let n = 0;
    for (const [key, s] of this.streams)
      if (key !== excludeKey && this.stateOf(s, now) === 'playing') n++;
    return n;
  }

  /** True for a stream that is playing or paused: resuming it never hits the stream limit. */
  isActive(key: string): boolean {
    const s = this.streams.get(key);
    return !!s && this.stateOf(s, Date.now()) !== null;
  }

  static key(ip: string, ua: string | undefined, videoId: string): string {
    return `${normalizeIp(ip)}|${createHash('sha1')
      .update(ua ?? '')
      .digest('hex')
      .slice(0, 8)}|${videoId}`;
  }

  /** Register traffic for a stream (creates it on first use). */
  record(opts: {
    ip: string;
    ua: string | undefined;
    videoId: string;
    title: string;
    mode: PlaybackMode;
    quality: QualityId;
    bytes: number;
  }) {
    const now = Date.now();
    const deviceId = this.touchDevice(opts.ip, opts.ua);
    const key = StreamTracker.key(opts.ip, opts.ua, opts.videoId);
    let s = this.streams.get(key);
    if (!s) {
      s = {
        id: randomUUID(),
        key,
        videoId: opts.videoId,
        title: opts.title,
        ip: normalizeIp(opts.ip),
        deviceId,
        mode: opts.mode,
        quality: opts.quality,
        startedAt: now,
        lastActivity: now,
        playerSeen: 0,
        playerState: 'playing',
        live: false,
        meter: new RateMeter(),
      };
      this.streams.set(key, s);
    }
    s.lastActivity = now;
    s.mode = opts.mode;
    s.quality = opts.quality;
    if (!s.live && this.stateOf(s, now)) this.emit('start', s);
    if (opts.bytes > 0) {
      s.meter.add(opts.bytes, now);
      this.devices.get(deviceId)?.meter.add(opts.bytes, now);
      this.global.add(opts.bytes, now);
    }
  }

  /** Bytes flowing for an already-open stream (called from data events). */
  addBytes(ip: string, ua: string | undefined, videoId: string, bytes: number) {
    const now = Date.now();
    const key = StreamTracker.key(ip, ua, videoId);
    const s = this.streams.get(key);
    if (s) {
      s.lastActivity = now;
      s.meter.add(bytes, now);
      this.devices.get(s.deviceId)?.meter.add(bytes, now);
    }
    this.global.add(bytes, now);
  }

  /**
   * Heartbeat from the web player (sent with watch progress every ~10 s, and on pause/stop).
   * Keeps a stream listed while the browser plays from its buffer without fetching anything.
   * Returns false when the stream is unknown; the caller then registers it with `record`.
   */
  heartbeat(ip: string, ua: string | undefined, videoId: string, state: PlayerState): boolean {
    const s = this.streams.get(StreamTracker.key(ip, ua, videoId));
    // Unknown: the browser played from its HTTP cache (a re-watch) or the server restarted.
    if (!s) return false;
    const now = Date.now();
    s.playerSeen = now;
    s.playerState = state;
    this.touchDevice(ip, ua);
    const active = this.stateOf(s, now);
    if (active && !s.live) this.emit('start', s);
    else if (!active && s.live) this.emit('stop', s);
    return true;
  }

  listStreams(): ActiveStream[] {
    const now = Date.now();
    const out: ActiveStream[] = [];
    for (const s of this.streams.values()) {
      const state = this.stateOf(s, now);
      if (!state) continue;
      out.push({
        id: s.id,
        videoId: s.videoId,
        title: s.title,
        ip: s.ip,
        deviceType: this.devices.get(s.deviceId)?.type ?? 'Unknown',
        mode: s.mode,
        quality: s.quality,
        state,
        startedAt: new Date(s.startedAt).toISOString(),
        lastActivity: new Date(Math.max(s.lastActivity, s.playerSeen)).toISOString(),
        bytesSent: s.meter.total,
        bandwidthBps: s.meter.rate(now),
      });
    }
    return out;
  }

  /** Live streams per device: playing ones first, then the most recently active. */
  private streamsByDevice(now: number) {
    const map = new Map<string, { s: StreamState; state: 'playing' | 'paused' }[]>();
    for (const s of this.streams.values()) {
      const state = this.stateOf(s, now);
      if (!state) continue;
      const list = map.get(s.deviceId) ?? [];
      list.push({ s, state });
      map.set(s.deviceId, list);
    }
    const seen = (x: StreamState) => Math.max(x.lastActivity, x.playerSeen);
    for (const list of map.values())
      list.sort(
        (a, b) =>
          (a.state === 'playing' ? 0 : 1) - (b.state === 'playing' ? 0 : 1) ||
          seen(b.s) - seen(a.s),
      );
    return map;
  }

  listDevices(): DeviceInfo[] {
    const now = Date.now();
    const byDevice = this.streamsByDevice(now);
    return (
      [...this.devices.values()]
        // A device with a paused video stays listed even if it made no request for a while.
        .filter((d) => now - d.lastSeen <= DEVICE_WINDOW_MS || byDevice.has(d.id))
        .map((d): DeviceInfo => {
          const list = byDevice.get(d.id) ?? [];
          const top = list[0];
          return {
            id: d.id,
            ip: d.ip,
            type: d.type,
            browser: d.browser,
            os: d.os,
            status: !top ? 'Idle' : top.state === 'playing' ? 'Streaming' : 'Paused',
            currentVideo: top?.s.title ?? null,
            activeStreams: list.length,
            mode: top?.s.mode ?? null,
            bandwidthBps: d.meter.rate(now),
            bytesSent: d.meter.total,
            firstSeen: new Date(d.firstSeen).toISOString(),
            lastSeen: new Date(d.lastSeen).toISOString(),
          };
        })
        // Streaming devices first, then paused, then idle; newest activity first within each.
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastSeen.localeCompare(a.lastSeen),
        )
    );
  }

  connectedCount(): number {
    const now = Date.now();
    const byDevice = this.streamsByDevice(now);
    let n = 0;
    for (const d of this.devices.values())
      if (now - d.lastSeen <= DEVICE_WINDOW_MS || byDevice.has(d.id)) n++;
    return n;
  }

  network() {
    return {
      currentBps: this.global.rate(),
      totalBytesSent: this.global.total,
      history: [...this.history],
    };
  }
}

const STATUS_ORDER: Record<DeviceInfo['status'], number> = { Streaming: 0, Paused: 1, Idle: 2 };

/** `::ffff:192.168.1.5` and `192.168.1.5` are the same device. */
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
