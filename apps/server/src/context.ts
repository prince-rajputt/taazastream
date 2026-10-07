import os from 'node:os';
import path from 'node:path';
import type { ServerInfo } from '@taazastream/shared';
import type { Logger } from 'pino';
import { APP_VERSION, type AppConfig } from './config';
import { LocalStorageProvider } from './cloud/storage-provider';
import { SupabaseSync } from './cloud/supabase-sync';
import { LocalAuth } from './core/auth';
import { BackupService } from './core/backup';
import { LocalDatabase, type Db } from './core/database';
import { Discovery } from './core/discovery';
import { FfmpegTools } from './core/ffmpeg';
import { LocalImageServer } from './core/images';
import { isForbiddenMediaRoot } from './core/paths';
import { LocalMediaScanner } from './core/scanner/scanner';
import { SearchService } from './core/search';
import { LocalSettings } from './core/settings';
import { HlsManager } from './core/streaming/hls';
import { LocalVideoStreamer } from './core/streaming/streamer';
import { StreamTracker } from './core/streaming/tracker';
import { SubtitleService } from './core/subtitles';
import { CpuMeter, lanAddresses } from './core/system';
import { CatalogService } from './services/catalog';
import { ProgressService } from './services/progress';

/**
 * Everything the server needs, wired together.
 *
 * Core (always local, no network):  LocalDatabase, LocalMediaScanner, LocalVideoStreamer,
 *                                   LocalImageServer, LocalAuth, LocalSettings
 * Optional cloud:                   SupabaseSync (CloudMetadata + CloudBackup)
 */
export interface AppContext {
  config: AppConfig;
  log: Logger;
  database: LocalDatabase;
  db: Db;
  settings: LocalSettings;
  auth: LocalAuth;
  ffmpeg: FfmpegTools;
  images: LocalImageServer;
  search: SearchService;
  scanner: LocalMediaScanner;
  tracker: StreamTracker;
  streamer: LocalVideoStreamer;
  hls: HlsManager;
  subtitles: SubtitleService;
  progress: ProgressService;
  catalog: CatalogService;
  backup: BackupService;
  storage: LocalStorageProvider;
  cloud: SupabaseSync;
  discovery: Discovery;
  cpu: CpuMeter;
  startedAt: number;
  serverInfo(): ServerInfo;
  defaultProfileId: string;
  restartDiscovery(): void;
  shutdown(): Promise<void>;
}

export async function createContext(config: AppConfig, log: Logger): Promise<AppContext> {
  const database = new LocalDatabase(config, log.child({ svc: 'db' }));
  await database.init();
  const db = database.client;

  const settings = new LocalSettings(db, config);
  await settings.load();

  const ffmpeg = new FfmpegTools(log.child({ svc: 'ffmpeg' }));
  await ffmpeg.detect({
    ffmpeg: settings.get().ffmpegPath,
    ffprobe: settings.get().ffprobePath,
    envFfmpeg: config.ffmpegPath,
    envFfprobe: config.ffprobePath,
  });

  const images = new LocalImageServer(config.imagesDir, ffmpeg, log.child({ svc: 'images' }));
  const search = new SearchService(database, log.child({ svc: 'search' }));
  const scanner = new LocalMediaScanner(db, ffmpeg, images, search, settings, log.child({ svc: 'scanner' }));
  const tracker = new StreamTracker();
  const streamer = new LocalVideoStreamer(tracker, log.child({ svc: 'stream' }), () => ({ maxStreams: settings.get().maxStreams }));
  const hls = new HlsManager(config.hlsDir, ffmpeg, () => settings.get(), log.child({ svc: 'hls' }));
  const subtitles = new SubtitleService(config.subtitlesDir, ffmpeg, log.child({ svc: 'subtitles' }));
  const progress = new ProgressService(db, log.child({ svc: 'progress' }));
  const catalog = new CatalogService(db);
  const backup = new BackupService(db, config.backupDir, log.child({ svc: 'backup' }));
  const storage = new LocalStorageProvider(path.join(config.dataDir, 'storage'));
  const auth = new LocalAuth(db, log.child({ svc: 'auth' }), config.sessionTtlMs);
  const cloud = new SupabaseSync(config, db, settings, config.imagesDir, log.child({ svc: 'cloud' }));
  const discovery = new Discovery(log.child({ svc: 'mdns' }));
  const cpu = new CpuMeter();

  // Default viewer profile so the app works without any sign-up.
  let profile = await db.user.findFirst({ where: { role: 'VIEWER' }, orderBy: { createdAt: 'asc' } });
  profile ??= await db.user.create({ data: { role: 'VIEWER', displayName: 'Home', color: '#f97316' } });

  // Optional bootstrap admin from the environment (first run only).
  if (config.adminBootstrap && !(await auth.adminExists())) {
    await auth.createAdmin(config.adminBootstrap.username, config.adminBootstrap.password);
    log.warn('Admin created from ADMIN_USERNAME/ADMIN_PASSWORD. Remove ADMIN_PASSWORD from .env now.');
  }

  // Seed media folders from MEDIA_ROOT on first run.
  for (const root of config.mediaRoots) {
    const resolved = path.resolve(root);
    if (isForbiddenMediaRoot(resolved)) continue;
    const exists = await db.mediaFolder.findUnique({ where: { path: resolved } });
    if (!exists) {
      await db.mediaFolder.create({ data: { path: resolved, label: path.basename(resolved) || resolved, kind: 'mixed' } });
      log.info({ path: resolved }, 'media folder added from MEDIA_ROOT');
    }
  }

  const startedAt = Date.now();

  const serverInfo = (): ServerInfo => {
    const ips = lanAddresses();
    const port = config.port;
    const urls = ips.map((ip) => `http://${ip}:${port}`);
    const s = settings.get();
    return {
      name: s.serverName,
      version: APP_VERSION,
      host: config.host,
      port,
      lanAddresses: ips,
      primaryUrl: urls[0] ?? `http://localhost:${port}`,
      urls,
      mdnsHost: discovery.hostname ? `http://${discovery.hostname}:${port}` : null,
      mdnsEnabled: !!discovery.hostname,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      nodeVersion: process.version,
      ffmpeg: { ...ffmpeg.ffmpeg },
      ffprobe: { ...ffmpeg.ffprobe },
      cloud: cloud.status,
    };
  };

  const restartDiscovery = () => {
    const s = settings.get();
    if (s.mdnsEnabled && config.mdnsEnabled && !config.isTest) {
      discovery.start({ hostname: s.mdnsHostname, port: config.port, name: s.serverName });
    } else {
      discovery.stop();
    }
  };

  settings.onChange(async (next, prev) => {
    if (next.ffmpegPath !== prev.ffmpegPath || next.ffprobePath !== prev.ffprobePath) {
      await ffmpeg.detect({ ffmpeg: next.ffmpegPath, ffprobe: next.ffprobePath, envFfmpeg: config.ffmpegPath, envFfprobe: config.ffprobePath });
    }
    if (next.mdnsEnabled !== prev.mdnsEnabled || next.mdnsHostname !== prev.mdnsHostname || next.serverName !== prev.serverName) {
      restartDiscovery();
    }
  });

  tracker.onStreamEvent((event, s) => {
    log.info({ svc: 'stream', ip: s.ip, videoId: s.videoId, title: s.title, mode: s.mode }, event === 'start' ? 'stream started' : 'stream stopped');
  });

  tracker.start();
  hls.start();
  progress.start();
  cpu.start();
  cloud.start();

  const shutdown = async () => {
    scanner.cancel();
    tracker.stop();
    cpu.stop();
    cloud.stop();
    discovery.stop();
    await hls.stopAll();
    await progress.stop();
    await database.close();
  };

  return {
    config,
    log,
    database,
    db,
    settings,
    auth,
    ffmpeg,
    images,
    search,
    scanner,
    tracker,
    streamer,
    hls,
    subtitles,
    progress,
    catalog,
    backup,
    storage,
    cloud,
    discovery,
    cpu,
    startedAt,
    serverInfo,
    defaultProfileId: profile.id,
    restartDiscovery,
    shutdown,
  };
}
