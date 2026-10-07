import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CloudStatus } from '@taazastream/shared';
import type { Logger } from 'pino';
import { APP_VERSION, type AppConfig } from '../config';
import { exportMetadata } from '../core/backup';
import type { Db } from '../core/database';
import type { LocalSettings } from '../core/settings';
import { SupabaseStorageProvider, type StorageProvider } from './storage-provider';

const CHECK_TIMEOUT_MS = 4_000;
const RECHECK_MS = 5 * 60_000;

/**
 * Optional cloud services (SupabaseSync / CloudMetadata / CloudBackup).
 *
 * Nothing in the core (catalog, playback, scanning, admin) depends on this class.
 * When Supabase is not configured or not reachable the server simply stays in local-only
 * mode and logs: "Supabase unavailable. Continuing in local-only mode."
 */
export class SupabaseSync {
  private client: SupabaseClient | null = null;
  private provider: StorageProvider | null = null;
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private state: CloudStatus;

  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly settings: LocalSettings,
    private readonly imagesDir: string,
    private readonly log: Logger,
  ) {
    const { url, anonKey, serviceRoleKey } = config.supabase;
    const configured = !!url && !!(anonKey || serviceRoleKey);
    this.state = {
      configured,
      reachable: false,
      mode: 'local-only',
      lastCheckedAt: null,
      lastSyncAt: null,
      message: configured ? 'Not checked yet' : 'Supabase is not configured (local-only mode)',
      canWrite: !!serviceRoleKey,
    };
    if (configured && serviceRoleKey) {
      // Service role key stays on the server; it is never exposed through any API.
      this.client = createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { 'x-client-info': `taazastream/${APP_VERSION}` } },
      });
      this.provider = new SupabaseStorageProvider(this.client, config.supabase.bucket);
    }
  }

  get status(): CloudStatus {
    return { ...this.state };
  }

  start() {
    if (!this.state.configured) {
      this.log.info('Supabase not configured. Running in local-only mode.');
      return;
    }
    void this.check();
    this.timer = setInterval(() => void this.check(), RECHECK_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Lightweight reachability probe with a short timeout. Never throws. */
  async check(): Promise<CloudStatus> {
    if (!this.state.configured) return this.status;
    const wasReachable = this.state.reachable;
    const { url, anonKey, serviceRoleKey } = this.config.supabase;
    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: anonKey || serviceRoleKey },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      this.state.reachable = res.ok;
      this.state.message = res.ok
        ? this.state.canWrite
          ? 'Connected to Supabase'
          : 'Connected (read-only: add SUPABASE_SERVICE_ROLE_KEY on the server to enable sync)'
        : `Supabase responded with HTTP ${res.status}`;
    } catch {
      this.state.reachable = false;
      this.state.message = 'Supabase unreachable — local-only mode';
    }
    this.state.lastCheckedAt = new Date().toISOString();
    this.state.mode = this.state.reachable && this.state.canWrite && this.settings.get().cloudSyncEnabled ? 'cloud-sync' : 'local-only';
    if (!this.state.reachable && (wasReachable || this.state.lastSyncAt === null)) {
      this.log.warn('Supabase unavailable. Continuing in local-only mode.');
    } else if (this.state.reachable && !wasReachable) {
      this.log.info({ canWrite: this.state.canWrite }, 'Supabase reachable');
    }
    return this.status;
  }

  private async serverId(): Promise<string> {
    let id = await this.settings.getValue<string | null>('server.id', null);
    if (!id) {
      id = `srv_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await this.settings.setValue('server.id', id);
    }
    return id;
  }

  /**
   * Push metadata (titles, artwork, a compressed metadata backup) to Supabase.
   * Safe to call any time: returns quietly when offline or not configured.
   */
  async sync(): Promise<{ ok: boolean; message: string; uploaded?: number }> {
    if (this.syncing) return { ok: false, message: 'A sync is already running' };
    if (!this.client || !this.provider) return { ok: false, message: 'Cloud sync requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server' };
    await this.check();
    if (!this.state.reachable) return { ok: false, message: 'Supabase unavailable. Continuing in local-only mode.' };

    this.syncing = true;
    const started = Date.now();
    try {
      const serverId = await this.serverId();
      const settings = this.settings.get();
      const up = await this.client.from('ts_servers').upsert({
        id: serverId,
        name: settings.serverName,
        version: APP_VERSION,
        last_seen_at: new Date().toISOString(),
      });
      if (up.error) throw new Error(up.error.message);

      // CloudMetadata: titles (no file paths are uploaded).
      const movies = await this.db.movie.findMany({ include: { genres: true } });
      const series = await this.db.series.findMany({ include: { genres: true } });
      const rows = [
        ...movies.map((m) => ({
          server_id: serverId,
          kind: 'movie',
          local_id: m.id,
          title: m.title,
          year: m.year,
          overview: m.overview,
          genres: m.genres.map((g) => g.name),
          data: { rating: m.rating, contentRating: m.contentRating, tagline: m.tagline, director: m.director, cast: safeJson(m.cast) },
          poster_key: m.posterImage ? `${serverId}/images/${m.posterImage}` : null,
          backdrop_key: m.backdropImage ? `${serverId}/images/${m.backdropImage}` : null,
          updated_at: m.updatedAt.toISOString(),
        })),
        ...series.map((s) => ({
          server_id: serverId,
          kind: 'series',
          local_id: s.id,
          title: s.title,
          year: s.year,
          overview: s.overview,
          genres: s.genres.map((g) => g.name),
          data: { rating: s.rating, contentRating: s.contentRating, cast: safeJson(s.cast) },
          poster_key: s.posterImage ? `${serverId}/images/${s.posterImage}` : null,
          backdrop_key: s.backdropImage ? `${serverId}/images/${s.backdropImage}` : null,
          updated_at: s.updatedAt.toISOString(),
        })),
      ];
      for (let i = 0; i < rows.length; i += 200) {
        const res = await this.client.from('ts_media_metadata').upsert(rows.slice(i, i + 200), { onConflict: 'server_id,kind,local_id' });
        if (res.error) throw new Error(res.error.message);
      }

      // Artwork (posters/backdrops only — small WebP files). Track what was uploaded already.
      const uploaded = new Set(await this.settings.getValue<string[]>('cloud.uploadedImages', []));
      const wanted = [...movies, ...series].flatMap((t) => [t.posterImage, t.backdropImage]).filter((x): x is string => !!x);
      let count = 0;
      for (const name of wanted) {
        if (uploaded.has(name)) continue;
        try {
          const data = await readFile(path.join(this.imagesDir, path.basename(name)));
          await this.provider.put(`${serverId}/images/${name}`, data, name.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
          uploaded.add(name);
          count++;
        } catch (err) {
          this.log.debug({ err: (err as Error).message, name }, 'artwork upload skipped');
        }
      }
      await this.settings.setValue('cloud.uploadedImages', [...uploaded].slice(-20_000));

      // CloudBackup: gzip'd metadata export.
      const meta = await exportMetadata(this.db);
      const json = JSON.stringify(meta, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v));
      const gz = gzipSync(json);
      const key = `${serverId}/backups/metadata-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
      await this.provider.put(key, gz, 'application/gzip');
      const rec = await this.client.from('ts_metadata_backups').insert({
        server_id: serverId,
        storage_key: key,
        size_bytes: gz.byteLength,
        counts: { movies: movies.length, series: series.length },
      });
      if (rec.error) throw new Error(rec.error.message);

      this.state.lastSyncAt = new Date().toISOString();
      this.log.info({ ms: Date.now() - started, titles: rows.length, images: count }, 'cloud sync complete');
      return { ok: true, message: `Synced ${rows.length} titles and ${count} images`, uploaded: count };
    } catch (err) {
      const message = (err as Error).message;
      this.log.warn({ err: message }, 'cloud sync failed; local operation is unaffected');
      return { ok: false, message: `Cloud sync failed: ${message}` };
    } finally {
      this.syncing = false;
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}
