import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  QUALITY_PRESETS,
  normalizeCodec,
  type AdminSettings,
  type QualityId,
} from '@taazastream/shared';
import type { Logger } from 'pino';
import { AppError } from '../../http/errors';
import type { FfmpegTools } from '../ffmpeg';

export interface HlsSource {
  id: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  durationSec: number;
  height: number | null;
  videoCodec: string | null;
  audioCodecs: string[];
}

export type VariantSpec =
  | { mode: 'transcode'; quality: Exclude<QualityId, 'original'>; audioIndex: number }
  | { mode: 'remux'; copyAudio: boolean; audioIndex: number };

const VARIANT_RE = /^(?:t-(1080p|720p|480p)|r-(c|e))-a(\d{1,2})$/;
const SEGMENT_RE = /^(?:seg_(\d{5})\.(ts|m4s)|init\.mp4)$/;
const REMUX_SEGMENT_SECONDS = 6;
/** How far ahead (in segments) of the newest finished segment a request may be before we seek. */
const LOOKAHEAD_SEGMENTS = 5;
/** Kill a transcode that runs this many segments ahead of the viewer (saves CPU). */
const MAX_AHEAD_SEGMENTS = 120;
const IDLE_KILL_MS = 30_000;
const SEGMENT_WAIT_MS = 60_000;

export function variantId(v: VariantSpec): string {
  return v.mode === 'transcode' ? `t-${v.quality}-a${v.audioIndex}` : `r-${v.copyAudio ? 'c' : 'e'}-a${v.audioIndex}`;
}

export function parseVariantId(id: string): VariantSpec | null {
  const m = VARIANT_RE.exec(id);
  if (!m) return null;
  const audioIndex = Number(m[3]);
  if (m[1]) return { mode: 'transcode', quality: m[1] as '1080p' | '720p' | '480p', audioIndex };
  return { mode: 'remux', copyAudio: m[2] === 'c', audioIndex };
}

export function isSegmentName(name: string): boolean {
  return SEGMENT_RE.test(name);
}

interface Job {
  id: string;
  kind: 'transcode' | 'remux';
  key: string;
  dir: string;
  proc: ChildProcess;
  startSegment: number;
  /** Highest segment index known to be complete (transcode only). */
  ready: number;
  lastRequested: number;
  lastAccess: number;
  owner: string;
  exited: boolean;
  exitCode: number | null;
  stderr: string;
  startedAt: number;
}

/**
 * HLS engine.
 *
 * - **transcode**: a VOD playlist with fixed-length segments is generated up front, so the
 *   player can seek anywhere instantly. Segments are produced on demand by FFmpeg; a request
 *   far from the running encoder restarts it at the requested segment (`-ss` + `-start_number`
 *   + `-output_ts_offset` keep timestamps continuous). Finished segments stay cached.
 * - **remux**: compatible codecs in an incompatible container (e.g. MKV) are copied into HLS
 *   without re-encoding — near-zero CPU, runs at disk speed.
 */
export class HlsManager {
  private jobs = new Map<string, Job>();
  private timer: NodeJS.Timeout | null = null;
  private hwBroken = false;
  private lastAccessByDir = new Map<string, number>();

  constructor(
    private readonly root: string,
    private readonly ffmpeg: FfmpegTools,
    private readonly settings: () => AdminSettings,
    private readonly log: Logger,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.housekeeping(), 5_000);
    this.timer.unref();
  }

  async stopAll() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const job of this.jobs.values()) this.kill(job, 'shutdown');
    this.jobs.clear();
  }

  get transcodeCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (!j.exited && j.kind === 'transcode') n++;
    return n;
  }

  get jobCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (!j.exited) n++;
    return n;
  }

  private sourceTag(src: HlsSource): string {
    return createHash('sha1').update(`${src.path}|${src.sizeBytes}|${src.mtimeMs}`).digest('hex').slice(0, 10);
  }

  private variantDir(src: HlsSource, v: VariantSpec): string {
    const segSeconds = v.mode === 'transcode' ? this.settings().hlsSegmentSeconds : REMUX_SEGMENT_SECONDS;
    return path.join(this.root, `${src.id}_${this.sourceTag(src)}`, `${variantId(v)}-s${segSeconds}`);
  }

  private ensureFfmpeg() {
    if (!this.ffmpeg.ffmpeg.available) {
      throw new AppError(503, 'TRANSCODER_UNAVAILABLE', 'FFmpeg is not installed on the server; this video cannot be converted');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Playlists                                                         */
  /* ---------------------------------------------------------------- */

  /** Master playlist listing the variants a client may switch between. */
  masterPlaylist(src: HlsSource, variants: VariantSpec[]): string {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-INDEPENDENT-SEGMENTS'];
    for (const v of variants) {
      if (v.mode === 'transcode') {
        const p = QUALITY_PRESETS[v.quality];
        const height = Math.min(p.height, src.height ?? p.height);
        const width = Math.round((height * 16) / 9 / 2) * 2;
        const bandwidth = (p.maxrateKbps + p.audioKbps) * 1000;
        lines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${(p.videoKbps + p.audioKbps) * 1000},RESOLUTION=${width}x${height},CODECS="avc1.640029,mp4a.40.2",NAME="${v.quality}"`,
          `${variantId(v)}/index.m3u8`,
        );
      } else {
        const bandwidth = Math.max(
          2_000_000,
          src.durationSec > 0 ? Math.round((src.sizeBytes * 8) / src.durationSec) : 8_000_000,
        );
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},NAME="original"`, `${variantId(v)}/index.m3u8`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  async variantPlaylist(src: HlsSource, v: VariantSpec, owner: string): Promise<string> {
    this.ensureFfmpeg();
    if (v.mode === 'transcode') return this.transcodePlaylist(src);
    return this.remuxPlaylist(src, v, owner);
  }

  private transcodePlaylist(src: HlsSource): string {
    const seg = this.settings().hlsSegmentSeconds;
    const duration = Math.max(src.durationSec, 0.1);
    const count = Math.max(1, Math.ceil(duration / seg - 1e-6));
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${seg}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ];
    for (let i = 0; i < count; i++) {
      const d = i === count - 1 ? duration - seg * (count - 1) : seg;
      lines.push(`#EXTINF:${Math.max(d, 0.04).toFixed(6)},`, `seg_${String(i).padStart(5, '0')}.ts`);
    }
    lines.push('#EXT-X-ENDLIST');
    return `${lines.join('\n')}\n`;
  }

  private async remuxPlaylist(src: HlsSource, v: VariantSpec & { mode: 'remux' }, owner: string): Promise<string> {
    const dir = this.variantDir(src, v);
    const playlist = path.join(dir, 'index.m3u8');
    const key = `remux:${dir}`;
    this.lastAccessByDir.set(path.dirname(dir), Date.now());

    let job = this.jobs.get(key);
    const complete = existsSync(playlist) && (await readFile(playlist, 'utf8')).includes('#EXT-X-ENDLIST');
    if (!complete && (!job || job.exited)) {
      await rm(dir, { recursive: true, force: true });
      job = await this.startRemux(src, v, dir, key, owner);
    }
    if (job) job.lastAccess = Date.now();

    const deadline = Date.now() + SEGMENT_WAIT_MS;
    while (Date.now() < deadline) {
      if (existsSync(playlist)) {
        const text = await readFile(playlist, 'utf8');
        if (/#EXTINF/.test(text) || text.includes('#EXT-X-ENDLIST')) return rewritePlaylist(text);
      }
      if (job?.exited) {
        if (job.exitCode === 0 && existsSync(playlist)) return rewritePlaylist(await readFile(playlist, 'utf8'));
        this.log.error({ videoId: src.id, err: job.stderr.slice(-500) }, 'remux failed');
        throw new AppError(500, 'TRANSCODE_FAILED', 'The video could not be prepared for streaming');
      }
      await delay(150);
    }
    throw new AppError(504, 'TRANSCODE_FAILED', 'Timed out preparing the stream');
  }

  /* ---------------------------------------------------------------- */
  /* Segments                                                          */
  /* ---------------------------------------------------------------- */

  /** Returns the absolute path of a finished segment, producing it first if needed. */
  async segment(src: HlsSource, v: VariantSpec, fileName: string, owner: string): Promise<string> {
    this.ensureFfmpeg();
    if (!isSegmentName(fileName)) throw new AppError(400, 'BAD_REQUEST', 'Invalid segment name');
    const dir = this.variantDir(src, v);
    this.lastAccessByDir.set(path.dirname(dir), Date.now());

    if (v.mode === 'remux') {
      const file = path.join(dir, fileName);
      const key = `remux:${dir}`;
      const job = this.jobs.get(key);
      if (job) job.lastAccess = Date.now();
      const deadline = Date.now() + SEGMENT_WAIT_MS;
      while (Date.now() < deadline) {
        if (existsSync(file)) return file;
        if (!job || job.exited) break;
        await delay(100);
      }
      throw new AppError(404, 'NOT_FOUND', 'Segment not available');
    }

    const index = Number(SEGMENT_RE.exec(fileName)?.[1] ?? NaN);
    const seg = this.settings().hlsSegmentSeconds;
    const count = Math.max(1, Math.ceil(Math.max(src.durationSec, 0.1) / seg - 1e-6));
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new AppError(404, 'NOT_FOUND', 'Segment out of range');
    }

    const existing = await this.findSegment(dir, index);
    const variantKeyPrefix = `transcode:${dir}:`;
    const variantJobs = [...this.jobs.values()].filter((j) => j.key.startsWith(variantKeyPrefix) && !j.exited);
    for (const j of variantJobs) {
      if (j.owner === owner) {
        j.lastAccess = Date.now();
        j.lastRequested = Math.max(index, j.startSegment);
      }
    }
    if (existing) return existing;

    let job = variantJobs.find((j) => index >= j.startSegment && index <= j.ready + LOOKAHEAD_SEGMENTS);
    if (!job) {
      // The viewer seeked: stop this viewer's other encoders for the variant, start a new one here.
      for (const j of variantJobs) if (j.owner === owner) this.kill(j, 'seek');
      job = await this.startTranscode(src, v as VariantSpec & { mode: 'transcode' }, dir, index, owner);
    }
    job.lastAccess = Date.now();
    job.lastRequested = index;

    const deadline = Date.now() + SEGMENT_WAIT_MS;
    while (Date.now() < deadline) {
      const found = await this.findSegment(dir, index, job);
      if (found) return found;
      if (job.exited) {
        const retry = await this.findSegment(dir, index);
        if (retry) return retry;
        this.log.error({ videoId: src.id, code: job.exitCode, err: job.stderr.slice(-600) }, 'FFmpeg transcode failed');
        throw new AppError(500, 'TRANSCODE_FAILED', 'FFmpeg failed to convert this video');
      }
      await delay(120);
    }
    throw new AppError(504, 'TRANSCODE_FAILED', 'Timed out waiting for the transcoder');
  }

  private async findSegment(variantDir: string, index: number, preferred?: Job): Promise<string | null> {
    const name = `seg_${String(index).padStart(5, '0')}.ts`;
    if (preferred) {
      const p = path.join(preferred.dir, name);
      if (existsSync(p)) {
        preferred.ready = Math.max(preferred.ready, index);
        return p;
      }
    }
    let subdirs: string[] = [];
    try {
      subdirs = await readdir(variantDir);
    } catch {
      return null;
    }
    for (const sub of subdirs) {
      const p = path.join(variantDir, sub, name);
      if (existsSync(p)) return p;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* FFmpeg jobs                                                       */
  /* ---------------------------------------------------------------- */

  private enforceTranscodeLimit(owner: string) {
    const max = this.settings().maxTranscodes;
    if (max <= 0) throw new AppError(503, 'STREAM_LIMIT', 'Transcoding is disabled on this server');
    const running = [...this.jobs.values()].filter((j) => j.kind === 'transcode' && !j.exited);
    if (running.length < max) return;
    // Evict the least recently used job, preferring this viewer's own or idle ones.
    const now = Date.now();
    const candidates = running
      .filter((j) => j.owner === owner || now - j.lastAccess > 8_000)
      .sort((a, b) => a.lastAccess - b.lastAccess);
    const victim = candidates[0];
    if (!victim) {
      throw new AppError(503, 'STREAM_LIMIT', 'The server is busy converting other videos. Try again shortly or choose a direct-play file.');
    }
    this.kill(victim, 'limit');
  }

  private videoEncoderArgs(quality: Exclude<QualityId, 'original'>, srcHeight: number | null): string[] {
    const s = this.settings();
    const p = QUALITY_PRESETS[quality];
    const seg = s.hlsSegmentSeconds;
    const needsScale = srcHeight == null || srcHeight > p.height;
    const hw = this.hwBroken ? 'none' : s.hardwareAcceleration;
    const scale = needsScale ? `scale=-2:${p.height}:flags=bicubic` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const rate = ['-b:v', `${p.videoKbps}k`, '-maxrate', `${p.maxrateKbps}k`, '-bufsize', `${p.maxrateKbps * 2}k`];
    const gop = ['-force_key_frames', `expr:gte(t,n_forced*${seg})`];
    switch (hw) {
      case 'nvenc':
        return ['-vf', `${scale},format=yuv420p`, '-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', ...rate, '-profile:v', 'high', '-forced-idr', '1', ...gop];
      case 'qsv':
        return ['-vf', `${scale},format=nv12`, '-c:v', 'h264_qsv', '-preset', 'veryfast', ...rate, '-profile:v', 'high', ...gop];
      case 'amf':
        return ['-vf', `${scale},format=yuv420p`, '-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'vbr_peak', ...rate, ...gop];
      default:
        return [
          '-vf', `${scale},format=yuv420p`,
          '-c:v', 'libx264', '-preset', s.transcodePreset, '-profile:v', 'high', '-level:v', '4.1',
          '-crf', '21', ...rate, '-sc_threshold', '0', ...gop,
          // Keep each encoder modest so several viewers can share the CPU.
          '-threads', '0', '-x264-params', 'rc-lookahead=20',
        ];
    }
  }

  private async startTranscode(
    src: HlsSource,
    v: VariantSpec & { mode: 'transcode' },
    variantDir: string,
    startSegment: number,
    owner: string,
  ): Promise<Job> {
    this.enforceTranscodeLimit(owner);
    const seg = this.settings().hlsSegmentSeconds;
    const startSec = startSegment * seg;
    const jobDir = path.join(variantDir, `j${startSegment}_${randomBytes(3).toString('hex')}`);
    await mkdir(jobDir, { recursive: true });
    const preset = QUALITY_PRESETS[v.quality];
    const args = [
      ...(startSec > 0 ? ['-ss', startSec.toFixed(3)] : []),
      '-i', src.path,
      '-map', '0:v:0', '-map', `0:a:${v.audioIndex}?`,
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      ...this.videoEncoderArgs(v.quality, src.height),
      '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', `${preset.audioKbps}k`,
      '-max_muxing_queue_size', '4096',
      '-f', 'hls',
      '-hls_time', String(seg),
      '-hls_list_size', '0',
      '-hls_segment_type', 'mpegts',
      '-start_number', String(startSegment),
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_filename', 'seg_%05d.ts',
      '-output_ts_offset', startSec.toFixed(3),
      'ffmpeg.m3u8',
    ];
    const key = `transcode:${variantDir}:${startSegment}:${randomBytes(2).toString('hex')}`;
    const job = this.spawnJob('transcode', key, jobDir, args, startSegment, owner);
    this.log.info({ videoId: src.id, quality: v.quality, startSegment, hw: this.hwBroken ? 'none' : this.settings().hardwareAcceleration }, 'FFmpeg transcode started');

    // Hardware encoders can be listed but unusable (no GPU / driver): fall back to x264 once.
    job.proc.once('exit', (code) => {
      const hw = this.settings().hardwareAcceleration;
      const killedByUs = job.stderr.includes('[killed:');
      const producedNothing = !existsSync(path.join(jobDir, `seg_${String(startSegment).padStart(5, '0')}.ts`));
      if (code !== 0 && !killedByUs && producedNothing && !this.hwBroken && hw !== 'none') {
        this.hwBroken = true;
        this.log.warn({ hw }, 'hardware encoder failed; falling back to software (libx264)');
      }
    });
    return job;
  }

  private async startRemux(src: HlsSource, v: VariantSpec & { mode: 'remux' }, dir: string, key: string, owner: string): Promise<Job> {
    await mkdir(dir, { recursive: true });
    const vcodec = normalizeCodec(src.videoCodec);
    const fmp4 = vcodec === 'hevc' || vcodec === 'av1' || vcodec === 'vp9';
    const args = [
      '-i', src.path,
      '-map', '0:v:0', '-map', `0:a:${v.audioIndex}?`,
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-c:v', 'copy',
      ...(vcodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
      ...(v.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k']),
      '-max_muxing_queue_size', '4096',
      '-f', 'hls',
      '-hls_time', String(REMUX_SEGMENT_SECONDS),
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      ...(fmp4 ? ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'] : ['-hls_segment_type', 'mpegts']),
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_filename', fmp4 ? 'seg_%05d.m4s' : 'seg_%05d.ts',
      'index.m3u8',
    ];
    const job = this.spawnJob('remux', key, dir, args, 0, owner);
    this.log.info({ videoId: src.id, copyAudio: v.copyAudio, fmp4 }, 'FFmpeg remux started');
    return job;
  }

  private spawnJob(kind: Job['kind'], key: string, dir: string, args: string[], startSegment: number, owner: string): Job {
    const proc = this.ffmpeg.spawnIn(args, dir);
    const job: Job = {
      id: randomBytes(4).toString('hex'),
      kind,
      key,
      dir,
      proc,
      startSegment,
      ready: startSegment - 1,
      lastRequested: startSegment,
      lastAccess: Date.now(),
      owner,
      exited: false,
      exitCode: null,
      stderr: '',
      startedAt: Date.now(),
    };
    proc.stderr?.on('data', (d: Buffer) => {
      job.stderr = (job.stderr + d.toString()).slice(-4000);
    });
    proc.on('error', (err) => {
      job.stderr += `\n${err.message}`;
    });
    proc.on('exit', (code) => {
      job.exited = true;
      job.exitCode = code;
      if (code !== 0 && code !== null && !job.stderr.includes('[killed:')) {
        this.log.warn({ kind, code, err: job.stderr.slice(-300) }, 'FFmpeg exited with an error');
      }
      // Keep exited remux jobs briefly so waiting requests see the result; drop transcode jobs.
      setTimeout(() => {
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      }, kind === 'remux' ? 60_000 : 1_000).unref();
    });
    this.jobs.set(key, job);
    return job;
  }

  private kill(job: Job, reason: string) {
    if (job.exited) return;
    job.stderr += `\n[killed: ${reason}]`;
    try {
      job.proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    this.log.debug({ kind: job.kind, reason }, 'FFmpeg job stopped');
  }

  /* ---------------------------------------------------------------- */
  /* Housekeeping                                                      */
  /* ---------------------------------------------------------------- */

  private lastPrune = 0;

  private async housekeeping() {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.exited) continue;
      if (now - job.lastAccess > IDLE_KILL_MS * (job.kind === 'remux' ? 2 : 1)) this.kill(job, 'idle');
      else if (job.kind === 'transcode') {
        // Track progress cheaply and pause runaway encoders far ahead of the viewer.
        while (existsSync(path.join(job.dir, `seg_${String(job.ready + 1).padStart(5, '0')}.ts`))) job.ready++;
        if (job.ready - job.lastRequested > MAX_AHEAD_SEGMENTS) this.kill(job, 'ahead');
      }
    }
    if (now - this.lastPrune > 10 * 60_000) {
      this.lastPrune = now;
      await this.pruneCache().catch((err) => this.log.warn({ err: (err as Error).message }, 'HLS cache prune failed'));
    }
  }

  async cacheSize(): Promise<number> {
    return dirSize(this.root);
  }

  /** Remove least-recently used converted videos until the cache fits `cacheMaxGb`. */
  async pruneCache(): Promise<{ removedBytes: number }> {
    const limit = this.settings().cacheMaxGb * 1024 ** 3;
    let entries: { dir: string; size: number; at: number }[] = [];
    for (const name of await readdir(this.root).catch(() => [] as string[])) {
      const dir = path.join(this.root, name);
      const busy = [...this.jobs.values()].some((j) => !j.exited && j.dir.startsWith(dir));
      if (busy) continue;
      const st = await stat(dir).catch(() => null);
      if (!st?.isDirectory()) continue;
      entries.push({ dir, size: await dirSize(dir), at: this.lastAccessByDir.get(dir) ?? st.mtimeMs });
    }
    let total = entries.reduce((s, e) => s + e.size, 0);
    entries = entries.sort((a, b) => a.at - b.at);
    let removedBytes = 0;
    for (const e of entries) {
      if (total <= limit) break;
      await rm(e.dir, { recursive: true, force: true });
      total -= e.size;
      removedBytes += e.size;
    }
    if (removedBytes) this.log.info({ removedBytes }, 'HLS cache pruned');
    return { removedBytes };
  }

  async clearCache(): Promise<void> {
    for (const job of this.jobs.values()) this.kill(job, 'cache-clear');
    for (const name of await readdir(this.root).catch(() => [] as string[])) {
      await rm(path.join(this.root, name), { recursive: true, force: true });
    }
  }
}

/** Make every URI in an FFmpeg playlist a bare file name (relative to the playlist URL). */
function rewritePlaylist(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (line.startsWith('#EXT-X-MAP:')) return line.replace(/URI="([^"]+)"/, (_, u: string) => `URI="${path.basename(u)}"`);
      if (line.startsWith('#')) return line;
      return path.basename(line.trim());
    })
    .join('\n');
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
