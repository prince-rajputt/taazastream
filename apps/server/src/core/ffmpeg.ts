import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export interface ToolInfo {
  available: boolean;
  path: string | null;
  version: string | null;
  /** settings | env | PATH | bundled | none */
  source: string;
}

export interface FfmpegCapabilities {
  webp: boolean;
  encoders: Set<string>;
}

/**
 * Locates ffmpeg/ffprobe. Order: admin setting → env var → system PATH → bundled
 * (ffmpeg-static / ffprobe-static npm packages, so TaazaStream works out of the box).
 */
export class FfmpegTools {
  ffmpeg: ToolInfo = { available: false, path: null, version: null, source: 'none' };
  ffprobe: ToolInfo = { available: false, path: null, version: null, source: 'none' };
  caps: FfmpegCapabilities = { webp: false, encoders: new Set() };

  constructor(private readonly log: Logger) {}

  async detect(preferred: {
    ffmpeg?: string;
    ffprobe?: string;
    envFfmpeg?: string;
    envFfprobe?: string;
  }) {
    this.ffmpeg = await this.resolve('ffmpeg', [
      ['settings', preferred.ffmpeg],
      ['env', preferred.envFfmpeg],
      ['PATH', 'ffmpeg'],
      ['bundled', bundledFfmpeg()],
    ]);
    this.ffprobe = await this.resolve('ffprobe', [
      ['settings', preferred.ffprobe],
      ['env', preferred.envFfprobe],
      ['PATH', 'ffprobe'],
      // Prefer an ffprobe that ships next to the chosen ffmpeg (same build).
      ['sibling', this.ffmpeg.path ? siblingProbe(this.ffmpeg.path) : undefined],
      ['bundled', bundledFfprobe()],
    ]);

    if (this.ffmpeg.available && this.ffmpeg.path) {
      try {
        const { stdout } = await execFileAsync(this.ffmpeg.path, ['-hide_banner', '-encoders'], {
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        const encoders = new Set<string>();
        for (const line of stdout.split('\n')) {
          const m = /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(line);
          if (m?.[1]) encoders.add(m[1]);
        }
        this.caps = { encoders, webp: encoders.has('libwebp') };
      } catch {
        this.caps = { encoders: new Set(), webp: false };
      }
    }

    this.log.info(
      {
        ffmpeg: { source: this.ffmpeg.source, version: this.ffmpeg.version },
        ffprobe: { source: this.ffprobe.source, version: this.ffprobe.version },
        webp: this.caps.webp,
      },
      this.ffmpeg.available && this.ffprobe.available
        ? 'FFmpeg detected'
        : 'FFmpeg/FFprobe not found – scanning metadata and transcoding are limited',
    );
  }

  private async resolve(
    name: string,
    candidates: [string, string | undefined | null][],
  ): Promise<ToolInfo> {
    for (const [source, candidate] of candidates) {
      if (!candidate) continue;
      if (source !== 'PATH' && !existsSync(candidate)) continue;
      try {
        const { stdout } = await execFileAsync(candidate, ['-hide_banner', '-version'], {
          windowsHide: true,
          timeout: 10_000,
        });
        const version = /version\s+(\S+)/.exec(stdout)?.[1] ?? 'unknown';
        return { available: true, path: candidate, version, source };
      } catch {
        if (source !== 'PATH')
          this.log.warn({ tool: name, source }, 'configured tool is not runnable');
      }
    }
    return { available: false, path: null, version: null, source: 'none' };
  }

  /** Run ffmpeg to completion (short jobs: thumbnails, subtitle extraction). */
  async run(args: string[], timeoutMs = 60_000): Promise<void> {
    if (!this.ffmpeg.path) throw new Error('FFmpeg is not available');
    await execFileAsync(
      this.ffmpeg.path,
      ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  }

  /** Spawn a long-running ffmpeg (HLS jobs) with `cwd` as its working directory. */
  spawnIn(args: string[], cwd: string): ChildProcess {
    if (!this.ffmpeg.path) throw new Error('FFmpeg is not available');
    return spawn(this.ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  }

  async probeJson(filePath: string, timeoutMs = 30_000): Promise<unknown> {
    if (!this.ffprobe.path) throw new Error('FFprobe is not available');
    const { stdout } = await execFileAsync(
      this.ffprobe.path,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  }
}

function bundledFfmpeg(): string | null {
  try {
    const p = require('ffmpeg-static') as string | null;
    return p ?? null;
  } catch {
    return null;
  }
}

function bundledFfprobe(): string | null {
  try {
    const mod = require('ffprobe-static') as { path?: string };
    return mod.path ?? null;
  } catch {
    return null;
  }
}

function siblingProbe(ffmpegPath: string): string | undefined {
  if (!path.isAbsolute(ffmpegPath)) return undefined;
  const ext = path.extname(ffmpegPath);
  const sibling = path.join(path.dirname(ffmpegPath), `ffprobe${ext}`);
  return existsSync(sibling) ? sibling : undefined;
}
