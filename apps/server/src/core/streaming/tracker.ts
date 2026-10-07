import { createHash, randomUUID } from 'node:crypto';
import type { ActiveStream, DeviceInfo, DeviceType, PlaybackMode, QualityId } from '@taazastream/shared';

/** A stream counts as active while it saw traffic within this window. */
const ACTIVE_WINDOW_MS = 20_000;
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
  lastActivity: number;
  meter: RateMeter;
}

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

export function classifyUserAgent(ua: string | undefined): { type: DeviceType; browser: string; os: string } {
  const s = ua ?? '';
  let type: DeviceType = 'Unknown';
  if (/smart-?tv|smarttv|tizen|web0s|webos|netcast|bravia|hbbtv|aft[a-z]|crkey|android tv|googletv|roku|appletv|philipstv|viera|vidaa/i.test(s)) type = 'TV';
  else if (/ipad|tablet|kindle|silk|playbook/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) type = 'Tablet';
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
  private listeners = new Set<(event: 'start' | 'stop', s: { ip: string; videoId: string; title: string; mode: PlaybackMode }) => void>();

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 2_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onStreamEvent(fn: (event: 'start' | 'stop', s: { ip: string; videoId: string; title: string; mode: PlaybackMode }) => void) {
    this.listeners.add(fn);
  }

  private tick() {
    const now = Date.now();
    this.history.push({ t: now, bps: this.global.rate(now) });
    if (this.history.length > 90) this.history.shift(); // ~3 minutes
    for (const [key, s] of this.streams) {
      if (now - s.lastActivity > ACTIVE_WINDOW_MS) {
        this.streams.delete(key);
        for (const fn of this.listeners) fn('stop', s);
      }
    }
    for (const [id, d] of this.devices) {
      if (now - d.lastSeen > DEVICE_WINDOW_MS * 10) this.devices.delete(id);
    }
  }

  deviceIdFor(ip: string, ua: string | undefined): string {
    return createHash('sha1').update(`${ip}|${ua ?? ''}`).digest('hex').slice(0, 16);
  }

  touchDevice(ip: string, ua: string | undefined): string {
    const id = this.deviceIdFor(ip, ua);
    const now = Date.now();
    const d = this.devices.get(id);
    if (d) d.lastSeen = now;
    else {
      const c = classifyUserAgent(ua);
      this.devices.set(id, { id, ip, ...c, firstSeen: now, lastSeen: now, meter: new RateMeter() });
    }
    return id;
  }

  /** Number of currently active streams, optionally excluding one key (for limit checks). */
  activeCount(excludeKey?: string): number {
    const now = Date.now();
    let n = 0;
    for (const [key, s] of this.streams) if (key !== excludeKey && now - s.lastActivity <= ACTIVE_WINDOW_MS) n++;
    return n;
  }

  isActive(key: string): boolean {
    const s = this.streams.get(key);
    return !!s && Date.now() - s.lastActivity <= ACTIVE_WINDOW_MS;
  }

  static key(ip: string, ua: string | undefined, videoId: string): string {
    return `${ip}|${createHash('sha1').update(ua ?? '').digest('hex').slice(0, 8)}|${videoId}`;
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
        ip: opts.ip,
        deviceId,
        mode: opts.mode,
        quality: opts.quality,
        startedAt: now,
        lastActivity: now,
        meter: new RateMeter(),
      };
      this.streams.set(key, s);
      for (const fn of this.listeners) fn('start', s);
    }
    s.lastActivity = now;
    s.mode = opts.mode;
    s.quality = opts.quality;
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

  listStreams(): ActiveStream[] {
    const now = Date.now();
    return [...this.streams.values()]
      .filter((s) => now - s.lastActivity <= ACTIVE_WINDOW_MS)
      .map((s) => ({
        id: s.id,
        videoId: s.videoId,
        title: s.title,
        ip: s.ip,
        deviceType: this.devices.get(s.deviceId)?.type ?? 'Unknown',
        mode: s.mode,
        quality: s.quality,
        startedAt: new Date(s.startedAt).toISOString(),
        lastActivity: new Date(s.lastActivity).toISOString(),
        bytesSent: s.meter.total,
        bandwidthBps: s.meter.rate(now),
      }));
  }

  listDevices(): DeviceInfo[] {
    const now = Date.now();
    const streams = [...this.streams.values()].filter((s) => now - s.lastActivity <= ACTIVE_WINDOW_MS);
    return [...this.devices.values()]
      .filter((d) => now - d.lastSeen <= DEVICE_WINDOW_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((d) => {
        const s = streams.find((x) => x.deviceId === d.id);
        return {
          id: d.id,
          ip: d.ip,
          type: d.type,
          browser: d.browser,
          os: d.os,
          status: s ? 'Streaming' : 'Idle',
          currentVideo: s?.title ?? null,
          mode: s?.mode ?? null,
          bandwidthBps: d.meter.rate(now),
          bytesSent: d.meter.total,
          firstSeen: new Date(d.firstSeen).toISOString(),
          lastSeen: new Date(d.lastSeen).toISOString(),
        };
      });
  }

  connectedCount(): number {
    const now = Date.now();
    let n = 0;
    for (const d of this.devices.values()) if (now - d.lastSeen <= DEVICE_WINDOW_MS) n++;
    return n;
  }

  network() {
    return { currentBps: this.global.rate(), totalBytesSent: this.global.total, history: [...this.history] };
  }
}
