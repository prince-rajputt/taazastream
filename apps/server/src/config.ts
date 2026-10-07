import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this file until we find the monorepo root (contains pnpm-workspace.yaml). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = process.env.TAAZASTREAM_ROOT
  ? path.resolve(process.env.TAAZASTREAM_ROOT)
  : findRepoRoot(here);

// .env lives in the repo root. Real environment variables always win.
loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v == null || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
    );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SERVER_NAME: z.string().max(64).optional(),
  DATABASE_URL: z.string().default('file:./data/taazastream.db'),
  DATA_DIR: z.string().default('./data'),
  CACHE_DIR: z.string().default('./cache'),
  BACKUP_DIR: z.string().default('./backups'),
  WEB_DIST: z.string().optional(),
  /** Optional initial media folders, separated by ';' (Windows) or the platform delimiter. */
  MEDIA_ROOT: z.string().default(''),
  FFMPEG_PATH: z.string().default(''),
  FFPROBE_PATH: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(false),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool(false),
  /** Allow admin APIs from non-private IPs. Strongly discouraged. */
  ALLOW_PUBLIC_ADMIN: bool(false),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .min(1)
    .max(24 * 90)
    .default(24 * 7),
  AUTO_MIGRATE: bool(true),
  /** Scan all media folders right after startup. */
  SCAN_ON_START: bool(false),
  MDNS_ENABLED: bool(true),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().default(''),
  /** Server-side only. Never sent to the browser. Enables cloud writes (sync / backup). */
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_BUCKET: z.string().default('taazastream-artwork'),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProd: boolean;
  isTest: boolean;
  host: string;
  port: number;
  serverName: string | undefined;
  repoRoot: string;
  dataDir: string;
  cacheDir: string;
  imagesDir: string;
  hlsDir: string;
  subtitlesDir: string;
  backupDir: string;
  webDist: string;
  databaseUrl: string;
  databasePath: string;
  mediaRoots: string[];
  ffmpegPath: string;
  ffprobePath: string;
  logLevel: Env['LOG_LEVEL'];
  logPretty: boolean;
  corsOrigins: string[];
  trustProxy: boolean;
  allowPublicAdmin: boolean;
  adminBootstrap: { username: string; password: string } | null;
  sessionTtlMs: number;
  autoMigrate: boolean;
  scanOnStart: boolean;
  mdnsEnabled: boolean;
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    bucket: string;
  };
}

function resolveFrom(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

/** Turn `file:./data/x.db` into an absolute `file:` URL so Prisma CLI and client agree. */
function resolveDatabaseUrl(root: string, url: string): { url: string; filePath: string } {
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite "file:" URL');
  const raw = url.slice('file:'.length);
  const [filePart = '', query] = raw.split('?');
  const filePath = resolveFrom(root, filePart);
  return {
    url: `file:${filePath.replace(/\\/g, '/')}${query ? `?${query}` : ''}`,
    filePath,
  };
}

export function loadConfig(overrides: Partial<Record<keyof Env, string>> = {}): AppConfig {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const root = REPO_ROOT;
  const dataDir = resolveFrom(root, env.DATA_DIR);
  const cacheDir = resolveFrom(root, env.CACHE_DIR);
  const backupDir = resolveFrom(root, env.BACKUP_DIR);
  const db = resolveDatabaseUrl(root, env.DATABASE_URL);

  for (const dir of [dataDir, cacheDir, backupDir, path.dirname(db.filePath)]) {
    mkdirSync(dir, { recursive: true });
  }
  const imagesDir = path.join(cacheDir, 'images');
  const hlsDir = path.join(cacheDir, 'hls');
  const subtitlesDir = path.join(cacheDir, 'subtitles');
  for (const dir of [imagesDir, hlsDir, subtitlesDir]) mkdirSync(dir, { recursive: true });

  const mediaRoots = env.MEDIA_ROOT.split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    env: env.NODE_ENV,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    host: env.HOST,
    port: env.PORT,
    serverName: env.SERVER_NAME,
    repoRoot: root,
    dataDir,
    cacheDir,
    imagesDir,
    hlsDir,
    subtitlesDir,
    backupDir,
    webDist: env.WEB_DIST
      ? resolveFrom(root, env.WEB_DIST)
      : path.join(root, 'apps', 'web', 'dist'),
    databaseUrl: db.url,
    databasePath: db.filePath,
    mediaRoots,
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY,
    allowPublicAdmin: env.ALLOW_PUBLIC_ADMIN,
    adminBootstrap:
      env.ADMIN_USERNAME && env.ADMIN_PASSWORD
        ? { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }
        : null,
    sessionTtlMs: env.SESSION_TTL_HOURS * 3600_000,
    autoMigrate: env.AUTO_MIGRATE,
    scanOnStart: env.SCAN_ON_START,
    mdnsEnabled: env.MDNS_ENABLED,
    supabase: {
      url: env.SUPABASE_URL.replace(/\/+$/, ''),
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_BUCKET,
    },
  };
}

export const APP_VERSION = '1.0.0';
