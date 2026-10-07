import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BackupInfo } from '@taazastream/shared';
import type { Logger } from 'pino';
import { APP_VERSION } from '../config';
import type { Db } from './database';

const KEEP_BACKUPS = 10;
const NAME_RE = /^taazastream-\d{8}-\d{6}\.(db|json)$/;

/** Everything except video files: settings, folders, titles, progress, lists. */
export async function exportMetadata(db: Db) {
  const [settings, folders, genres, movies, series, users, favorites, continueWatching, playlists] = await Promise.all([
    db.serverSetting.findMany(),
    db.mediaFolder.findMany(),
    db.genre.findMany(),
    db.movie.findMany({ include: { genres: { select: { slug: true } }, videos: { select: { relPath: true, folderId: true } } } }),
    db.series.findMany({
      include: {
        genres: { select: { slug: true } },
        seasons: { include: { episodes: { include: { videos: { select: { relPath: true, folderId: true } } } } } },
      },
    }),
    db.user.findMany({ select: { id: true, username: true, role: true, displayName: true, color: true, isKids: true } }),
    db.favorite.findMany(),
    db.continueWatching.findMany(),
    db.playlist.findMany({ include: { items: true } }),
  ]);
  return {
    format: 'taazastream-metadata',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    host: os.hostname(),
    settings,
    mediaFolders: folders,
    genres,
    movies,
    series,
    profiles: users,
    favorites,
    continueWatching,
    playlists,
  };
}

/**
 * Local backups of the SQLite database (consistent snapshot via `VACUUM INTO`) plus a
 * portable JSON export of metadata and configuration. Video files are never included.
 */
export class BackupService {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
    private readonly log: Logger,
  ) {}

  private stamp(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async create(): Promise<BackupInfo[]> {
    await mkdir(this.dir, { recursive: true });
    const base = `taazastream-${this.stamp()}`;
    const dbFile = path.join(this.dir, `${base}.db`);
    const jsonFile = path.join(this.dir, `${base}.json`);
    if (existsSync(dbFile)) await rm(dbFile);
    // VACUUM INTO produces a consistent, compacted copy even while the server is running.
    await this.db.$executeRawUnsafe(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
    const meta = await exportMetadata(this.db);
    await writeFile(jsonFile, JSON.stringify(meta, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v), 2));
    await this.rotate();
    this.log.info({ backup: base }, 'backup created');
    return (await this.list()).filter((b) => b.fileName.startsWith(base));
  }

  async list(): Promise<BackupInfo[]> {
    const out: BackupInfo[] = [];
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!NAME_RE.test(name)) continue;
      const st = await stat(path.join(this.dir, name)).catch(() => null);
      if (st) out.push({ fileName: name, sizeBytes: st.size, createdAt: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.fileName.localeCompare(a.fileName));
  }

  resolve(fileName: string): string | null {
    if (!NAME_RE.test(fileName)) return null;
    const full = path.join(this.dir, fileName);
    return existsSync(full) ? full : null;
  }

  async remove(fileName: string): Promise<boolean> {
    const full = this.resolve(fileName);
    if (!full) return false;
    await rm(full, { force: true });
    return true;
  }

  private async rotate() {
    const all = await this.list();
    const stamps = [...new Set(all.map((b) => b.fileName.replace(/\.(db|json)$/, '')))];
    for (const old of stamps.slice(KEEP_BACKUPS)) {
      await rm(path.join(this.dir, `${old}.db`), { force: true });
      await rm(path.join(this.dir, `${old}.json`), { force: true });
    }
  }
}
