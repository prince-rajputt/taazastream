import { existsSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Subtitle } from '@prisma/client';
import type { Logger } from 'pino';
import { AppError, fsError } from '../http/errors';
import type { FfmpegTools } from './ffmpeg';
import { isInsideAny } from './paths';

const TEXT_FORMATS = new Set(['srt', 'subrip', 'vtt', 'webvtt', 'ass', 'ssa', 'mov_text', 'text']);
const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;

/** Strip a UTF-8 BOM and normalise line endings. */
function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** Convert SubRip (.srt) to WebVTT without any external tools. */
export function srtToVtt(srt: string): string {
  const body = normalize(srt)
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.trim().split('\n');
      if (lines.length && /^\d+$/.test(lines[0]!.trim())) lines.shift();
      if (!lines.length) return '';
      lines[0] = lines[0]!.replace(
        /(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g,
        (_, t: string, ms: string) => `${t.padStart(8, '0')}.${ms.padEnd(3, '0')}`,
      );
      if (!lines[0].includes('-->')) return '';
      return lines
        .map((l, i) =>
          i === 0 ? l : l.replace(/<(?!\/?(b|i|u)>)[^>]*>/gi, '').replace(/\{\\[^}]*\}/g, ''),
        )
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function isTextSubtitle(format: string): boolean {
  return TEXT_FORMATS.has(format.toLowerCase());
}

/**
 * Serves every subtitle as WebVTT (what <track> understands). Sidecar SRT is converted in
 * process; ASS/SSA and embedded text tracks are extracted once with FFmpeg and cached.
 */
export class SubtitleService {
  constructor(
    private readonly cacheDir: string,
    private readonly ffmpeg: FfmpegTools,
    private readonly log: Logger,
  ) {}

  private cachePath(sub: Subtitle, sourceMtime: number): string {
    return path.join(this.cacheDir, `${sub.id}_${Math.floor(sourceMtime).toString(36)}.vtt`);
  }

  async toVtt(sub: Subtitle, video: { path: string; folderPath: string }): Promise<string> {
    if (!isTextSubtitle(sub.format)) {
      throw new AppError(
        415,
        'BAD_REQUEST',
        'Image-based subtitles (PGS/VobSub) cannot be shown in the browser',
      );
    }

    if (sub.source === 'uploaded') {
      const file = sub.path ? path.join(this.cacheDir, path.basename(sub.path)) : null;
      if (!file || !existsSync(file)) throw new AppError(404, 'NOT_FOUND', 'Subtitle file missing');
      return readFile(file, 'utf8');
    }

    if (sub.source === 'sidecar') {
      if (!sub.path || !isInsideAny([video.folderPath], sub.path))
        throw new AppError(403, 'FORBIDDEN', 'Subtitle outside library');
      let st;
      try {
        st = await stat(sub.path);
      } catch (err) {
        throw fsError(err, 'Subtitle file');
      }
      if (st.size > MAX_SUBTITLE_BYTES)
        throw new AppError(413, 'BAD_REQUEST', 'Subtitle file too large');
      const fmt = sub.format.toLowerCase();
      if (fmt === 'vtt' || fmt === 'webvtt') return normalize(await readFile(sub.path, 'utf8'));
      if (fmt === 'srt' || fmt === 'subrip') return srtToVtt(await readFile(sub.path, 'utf8'));
      return this.extract(sub, sub.path, null, st.mtimeMs);
    }

    // embedded
    let mtime = 0;
    try {
      mtime = (await stat(video.path)).mtimeMs;
    } catch (err) {
      throw fsError(err, 'Video file');
    }
    return this.extract(sub, video.path, sub.streamIndex, mtime);
  }

  private async extract(
    sub: Subtitle,
    input: string,
    streamIndex: number | null,
    mtime: number,
  ): Promise<string> {
    const out = this.cachePath(sub, mtime);
    if (existsSync(out)) return readFile(out, 'utf8');
    if (!this.ffmpeg.ffmpeg.available) {
      throw new AppError(
        503,
        'TRANSCODER_UNAVAILABLE',
        'FFmpeg is required to convert this subtitle',
      );
    }
    const tmp = `${out}.tmp.vtt`;
    try {
      await this.ffmpeg.run(
        [
          '-i',
          input,
          ...(streamIndex != null ? ['-map', `0:${streamIndex}`] : []),
          '-c:s',
          'webvtt',
          '-f',
          'webvtt',
          '-y',
          tmp,
        ],
        120_000,
      );
      await rename(tmp, out);
      return readFile(out, 'utf8');
    } catch (err) {
      await rm(tmp, { force: true });
      this.log.warn(
        { subtitleId: sub.id, err: (err as Error).message.slice(0, 300) },
        'subtitle extraction failed',
      );
      throw new AppError(500, 'TRANSCODE_FAILED', 'Subtitle could not be converted');
    }
  }

  /** Save an admin-uploaded subtitle (SRT or VTT) into the cache as WebVTT. Returns the file name. */
  async saveUpload(id: string, data: Buffer, format: 'srt' | 'vtt'): Promise<string> {
    if (data.byteLength > MAX_SUBTITLE_BYTES)
      throw new AppError(413, 'BAD_REQUEST', 'Subtitle file too large');
    const text = data.toString('utf8');
    const vtt = format === 'srt' ? srtToVtt(text) : normalize(text);
    if (!vtt.startsWith('WEBVTT'))
      throw new AppError(400, 'BAD_REQUEST', 'Not a valid WebVTT file');
    const name = `upload_${id}.vtt`;
    await writeFile(path.join(this.cacheDir, name), vtt, 'utf8');
    return name;
  }

  async removeUpload(name: string | null) {
    if (!name) return;
    await rm(path.join(this.cacheDir, path.basename(name)), { force: true });
  }
}
