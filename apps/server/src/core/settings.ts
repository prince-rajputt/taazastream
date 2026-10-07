import os from 'node:os';
import type { AdminSettings, SettingsPatch } from '@taazastream/shared';
import type { Db } from './database';
import type { AppConfig } from '../config';

const SETTINGS_KEY = 'app.settings';

export function defaultSettings(config: AppConfig): AdminSettings {
  const cpus = os.cpus().length || 2;
  return {
    serverName: config.serverName ?? `TaazaStream on ${os.hostname()}`,
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    defaultQuality: 'original',
    maxStreams: 8,
    // Software x264 transcodes are CPU heavy; scale the default with the core count.
    maxTranscodes: Math.max(1, Math.min(4, Math.floor(cpus / 4))),
    transcodePreset: 'veryfast',
    hardwareAcceleration: 'none',
    hlsSegmentSeconds: 4,
    cacheMaxGb: 20,
    thumbnailsEnabled: true,
    mdnsEnabled: config.mdnsEnabled,
    mdnsHostname: 'taazastream',
    autoScanIntervalMinutes: 0,
    cloudSyncEnabled: false,
  };
}

/**
 * LocalSettings — admin-editable settings persisted in SQLite, cached in memory.
 */
export class LocalSettings {
  private cache: AdminSettings | null = null;
  private listeners = new Set<(s: AdminSettings, prev: AdminSettings) => void>();

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async load(): Promise<AdminSettings> {
    const defaults = defaultSettings(this.config);
    const row = await this.db.serverSetting.findUnique({ where: { key: SETTINGS_KEY } });
    let stored: Partial<AdminSettings> = {};
    if (row) {
      try {
        stored = JSON.parse(row.value) as Partial<AdminSettings>;
      } catch {
        stored = {};
      }
    }
    this.cache = { ...defaults, ...stored };
    return this.cache;
  }

  get(): AdminSettings {
    if (!this.cache) throw new Error('Settings not loaded');
    return this.cache;
  }

  async update(patch: SettingsPatch): Promise<AdminSettings> {
    const prev = this.get();
    const next: AdminSettings = { ...prev, ...patch };
    await this.db.serverSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    this.cache = next;
    for (const fn of this.listeners) fn(next, prev);
    return next;
  }

  onChange(fn: (s: AdminSettings, prev: AdminSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Small typed key/value helpers for internal state (e.g. cloud sync bookkeeping). */
  async getValue<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.serverSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  async setValue(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    await this.db.serverSetting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }
}
