import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isInside } from '../core/paths';

/**
 * Storage abstraction for small artefacts (artwork, subtitles, metadata backups).
 * Video files are never written through this interface.
 */
export interface StorageProvider {
  readonly name: 'local' | 'supabase';
  put(key: string, data: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  delete(key: string): Promise<void>;
}

function assertKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]{1,512}$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

/** Default provider: everything stays on the local disk. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertKey(key);
    const full = path.join(this.root, key);
    if (!isInside(this.root, full)) throw new Error('Key escapes storage root');
    return full;
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer | null> {
    const full = this.resolve(key);
    return existsSync(full) ? readFile(full) : null;
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key));
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const dir = this.resolve(prefix.replace(/\/+$/, '') || '.');
    const out: { key: string; size: number }[] = [];
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const st = await stat(path.join(dir, name)).catch(() => null);
      if (st?.isFile()) out.push({ key: `${prefix.replace(/\/+$/, '')}/${name}`, size: st.size });
    }
    return out;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

/** Optional cloud provider backed by Supabase Storage (server-side service key only). */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = 'supabase' as const;

  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async put(key: string, data: Buffer | string, contentType: string): Promise<void> {
    assertKey(key);
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(error.message);
  }

  async get(key: string): Promise<Buffer | null> {
    assertKey(key);
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    const dir = path.posix.dirname(key);
    const name = path.posix.basename(key);
    const { data } = await this.client.storage.from(this.bucket).list(dir === '.' ? '' : dir, { search: name, limit: 1 });
    return !!data?.some((o) => o.name === name);
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const p = prefix.replace(/\/+$/, '');
    const { data, error } = await this.client.storage.from(this.bucket).list(p, { limit: 1000 });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((o) => o.id)
      .map((o) => ({ key: `${p}/${o.name}`, size: Number((o.metadata as { size?: number } | null)?.size ?? 0) }));
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.storage.from(this.bucket).remove([key]);
  }
}
