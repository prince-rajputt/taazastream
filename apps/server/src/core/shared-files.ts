import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SharedFile, SharedKind } from '@taazastream/shared';
import type { Logger } from 'pino';
import type { FfmpegTools } from './ffmpeg';
import { sniffImage } from './images';
import { joinInside } from './paths';

interface Entry {
  id: string;
  kind: SharedKind;
  name: string;
  ext: string;
  sizeBytes: number;
  uploadedAt: string;
  thumb: string | null;
}

export const SHARED_LIMITS: Record<SharedKind, { maxBytes: number; label: string }> = {
  pdf: { maxBytes: 200 * 1024 * 1024, label: '200 MB' },
  image: { maxBytes: 40 * 1024 * 1024, label: '40 MB' },
};

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const ID = /^[a-f0-9]{16}$/;

export class SharedFileError extends Error {}

/** Detect the real type from the first bytes; the client-supplied name/MIME is never trusted. */
function sniff(head: Buffer, kind: SharedKind): string | null {
  if (kind === 'pdf') return head.toString('latin1', 0, 5) === '%PDF-' ? 'pdf' : null;
  if (head.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return sniffImage(head);
}

/**
 * LocalSharedFiles — PDFs and images the admin shares with every device on the LAN.
 * Files live in `<data>/shared/files` under random names; a small JSON manifest keeps the
 * original names. Kept out of `cache/images`, which is pruned against the database.
 */
export class LocalSharedFiles {
  private readonly filesDir: string;
  private readonly thumbsDir: string;
  private readonly manifest: string;
  private entries = new Map<string, Entry>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    dir: string,
    private readonly ffmpeg: FfmpegTools,
    private readonly log: Logger,
  ) {
    this.filesDir = path.join(dir, 'files');
    this.thumbsDir = path.join(dir, 'thumbs');
    this.manifest = path.join(dir, 'index.json');
    for (const d of [this.filesDir, this.thumbsDir]) mkdirSync(d, { recursive: true });
  }

  async load(): Promise<void> {
    if (!existsSync(this.manifest)) return;
    try {
      const list = JSON.parse(await readFile(this.manifest, 'utf8')) as Entry[];
      // Drop entries whose file was removed by hand.
      this.entries = new Map(
        list
          .filter((e) => ID.test(e.id) && existsSync(path.join(this.filesDir, `${e.id}.${e.ext}`)))
          .map((e) => [e.id, e]),
      );
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'shared files manifest unreadable');
    }
  }

  private persist(): Promise<void> {
    // Serialise writes; write-then-rename so a crash never leaves a half-written manifest.
    const run = async () => {
      const tmp = `${this.manifest}.tmp`;
      await writeFile(tmp, JSON.stringify([...this.entries.values()], null, 2));
      await rename(tmp, this.manifest);
    };
    this.writing = this.writing.then(run, run);
    return this.writing;
  }

  private toDto(e: Entry): SharedFile {
    const base = `/api/shared-files/${e.id}`;
    return {
      id: e.id,
      kind: e.kind,
      name: e.name,
      sizeBytes: e.sizeBytes,
      uploadedAt: e.uploadedAt,
      url: base,
      downloadUrl: `${base}?download=1`,
      thumbUrl: e.thumb ? `${base}/thumb` : null,
    };
  }

  list(kind: SharedKind): SharedFile[] {
    return [...this.entries.values()]
      .filter((e) => e.kind === kind)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .map((e) => this.toDto(e));
  }

  /** Absolute path, MIME type and original name for serving, or null when unknown. */
  resolve(id: string): { file: string; type: string; name: string; sizeBytes: number } | null {
    const e = ID.test(id) ? this.entries.get(id) : undefined;
    if (!e) return null;
    const file = joinInside(this.filesDir, `${e.id}.${e.ext}`);
    if (!file || !existsSync(file)) return null;
    return {
      file,
      type: MIME[e.ext] ?? 'application/octet-stream',
      name: e.name,
      sizeBytes: e.sizeBytes,
    };
  }

  resolveThumb(id: string): { file: string; type: string } | null {
    const e = ID.test(id) ? this.entries.get(id) : undefined;
    if (!e?.thumb) return null;
    const file = joinInside(this.thumbsDir, e.thumb);
    if (!file || !existsSync(file)) return null;
    return { file, type: e.thumb.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
  }

  /** Stream one upload to disk, validate it by magic bytes, and register it. */
  async save(
    kind: SharedKind,
    originalName: string,
    stream: Readable & { truncated?: boolean },
  ): Promise<SharedFile> {
    const id = randomBytes(8).toString('hex');
    const tmp = path.join(this.filesDir, `${id}.upload`);
    try {
      await pipeline(stream, createWriteStream(tmp));
      if (stream.truncated)
        throw new SharedFileError(`"${originalName}" is larger than ${SHARED_LIMITS[kind].label}`);

      const handle = await open(tmp, 'r');
      const head = Buffer.alloc(16);
      let size: number;
      try {
        await handle.read(head, 0, 16, 0);
        size = (await handle.stat()).size;
      } finally {
        await handle.close();
      }
      const ext = sniff(head, kind);
      if (!ext)
        throw new SharedFileError(
          kind === 'pdf'
            ? `"${originalName}" is not a PDF file`
            : `"${originalName}" is not a supported image. Use JPEG, PNG, WebP or GIF.`,
        );

      const final = path.join(this.filesDir, `${id}.${ext}`);
      await rename(tmp, final);
      const entry: Entry = {
        id,
        kind,
        name: cleanName(originalName, ext),
        ext,
        sizeBytes: size,
        uploadedAt: new Date().toISOString(),
        thumb: kind === 'image' ? await this.makeThumb(final, id) : null,
      };
      this.entries.set(id, entry);
      await this.persist();
      return this.toDto(entry);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  private async makeThumb(source: string, id: string): Promise<string | null> {
    if (!this.ffmpeg.ffmpeg.available) return null;
    const webp = this.ffmpeg.caps.webp;
    const name = `${id}.${webp ? 'webp' : 'jpg'}`;
    const out = path.join(this.thumbsDir, name);
    const codec = webp ? ['-c:v', 'libwebp', '-quality', '75'] : ['-q:v', '4'];
    try {
      await this.ffmpeg.run(
        ['-i', source, '-vf', "scale='min(600,iw)':-2", '-frames:v', '1', ...codec, '-y', out],
        30_000,
      );
      return name;
    } catch (err) {
      await rm(out, { force: true });
      this.log.warn({ err: (err as Error).message }, 'gallery thumbnail failed');
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    const e = ID.test(id) ? this.entries.get(id) : undefined;
    if (!e) return false;
    this.entries.delete(id);
    await this.persist();
    await rm(path.join(this.filesDir, `${e.id}.${e.ext}`), { force: true });
    if (e.thumb) await rm(path.join(this.thumbsDir, e.thumb), { force: true });
    return true;
  }
}

/** Keep the original name for display, minus any path and control characters. */
function cleanName(name: string, ext: string): string {
  // eslint-disable-next-line no-control-regex
  const base = path
    .basename(name.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (base || `file.${ext}`).slice(0, 200);
}
