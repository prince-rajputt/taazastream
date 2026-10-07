import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import type { FfmpegTools } from './ffmpeg';
import { joinInside } from './paths';

export type ImageRole = 'poster' | 'backdrop' | 'thumb' | 'season';

const SIZES: Record<ImageRole, { width: number; quality: number }> = {
  poster: { width: 500, quality: 80 },
  backdrop: { width: 1600, quality: 78 },
  thumb: { width: 640, quality: 75 },
  season: { width: 400, quality: 80 },
};

/**
 * LocalImageServer — every image TaazaStream shows lives in `cache/images` as a generated
 * WebP (JPEG fallback). Artwork is never fetched from the internet. URLs reference opaque
 * file names, never filesystem paths.
 */
export class LocalImageServer {
  constructor(
    private readonly dir: string,
    private readonly ffmpeg: FfmpegTools,
    private readonly log: Logger,
  ) {}

  get extension(): 'webp' | 'jpg' {
    return this.ffmpeg.caps.webp ? 'webp' : 'jpg';
  }

  static urlFor(name: string | null | undefined): string | null {
    return name ? `/api/images/${name}` : null;
  }

  /** Absolute path for a stored image name, or null when the name is invalid/missing. */
  resolve(name: string): string | null {
    const full = joinInside(this.dir, name);
    return full && existsSync(full) ? full : null;
  }

  private newName(role: ImageRole, key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'x';
    return `${role}_${safeKey}_${randomBytes(4).toString('hex')}.${this.extension}`;
  }

  private encodeArgs(role: ImageRole): string[] {
    const { width, quality } = SIZES[role];
    const scale = `scale='min(${width},iw)':-2:flags=lanczos`;
    const codec =
      this.extension === 'webp'
        ? ['-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '4']
        : ['-q:v', '4'];
    return ['-vf', scale, '-frames:v', '1', ...codec];
  }

  /** Grab a representative frame from a video. */
  async fromVideo(videoPath: string, atSec: number, role: ImageRole, key: string): Promise<string | null> {
    if (!this.ffmpeg.ffmpeg.available) return null;
    const name = this.newName(role, key);
    const out = path.join(this.dir, name);
    const tmp = `${out}.tmp.${this.extension}`;
    try {
      await this.ffmpeg.run(
        ['-ss', Math.max(0, atSec).toFixed(2), '-i', videoPath, ...this.encodeArgs(role), '-an', '-sn', '-y', tmp],
        45_000,
      );
      if (!existsSync(tmp) || (await stat(tmp)).size === 0) throw new Error('empty frame');
      await rename(tmp, out);
      return name;
    } catch (err) {
      await rm(tmp, { force: true });
      this.log.debug({ err: (err as Error).message, role }, 'frame extraction failed');
      return null;
    }
  }

  /** Convert a local artwork file (sidecar poster/fanart or an upload) into a cached image. */
  async fromFile(sourcePath: string, role: ImageRole, key: string): Promise<string | null> {
    if (!this.ffmpeg.ffmpeg.available) return null;
    const name = this.newName(role, key);
    const out = path.join(this.dir, name);
    const tmp = `${out}.tmp.${this.extension}`;
    try {
      await this.ffmpeg.run(['-i', sourcePath, ...this.encodeArgs(role), '-y', tmp], 30_000);
      await rename(tmp, out);
      return name;
    } catch (err) {
      await rm(tmp, { force: true });
      this.log.warn({ err: (err as Error).message, role }, 'artwork conversion failed');
      return null;
    }
  }

  /** Store an uploaded image buffer (validated by magic bytes) and convert it. */
  async fromUpload(data: Buffer, role: ImageRole, key: string): Promise<string> {
    const kind = sniffImage(data);
    if (!kind) throw new Error('Unsupported image type. Use JPEG, PNG or WebP.');
    const tmpIn = path.join(this.dir, `upload_${randomBytes(6).toString('hex')}.${kind}`);
    await writeFile(tmpIn, data);
    try {
      const name = await this.fromFile(tmpIn, role, key);
      if (!name) throw new Error('Image could not be processed');
      return name;
    } finally {
      await rm(tmpIn, { force: true });
    }
  }

  async remove(name: string | null | undefined): Promise<void> {
    if (!name) return;
    const full = joinInside(this.dir, name);
    if (full) await rm(full, { force: true });
  }

  /** Delete images no longer referenced by the database. */
  async prune(referenced: Set<string>): Promise<number> {
    let removed = 0;
    for (const file of await readdir(this.dir)) {
      if (!referenced.has(file)) {
        await rm(path.join(this.dir, file), { force: true });
        removed++;
      }
    }
    return removed;
  }
}

export function sniffImage(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
