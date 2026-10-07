import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createContext, type AppContext } from '../src/context';

export interface TestServer {
  app: FastifyInstance;
  ctx: AppContext;
  dir: string;
  mediaDir: string;
  /** Inject with the CSRF header and JSON helpers. */
  req: (opts: InjectOptions & { cookie?: string }) => Promise<LightMyRequestResponse>;
  login: () => Promise<string>;
  close: () => Promise<void>;
}

export const ADMIN = { username: 'admin', password: 'super-secret-pass' };

/** Boots a complete TaazaStream server (real SQLite + FFmpeg) in a temp directory. */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'taazastream-test-'));
  const mediaDir = process.env.TAAZASTREAM_TEST_MEDIA!;
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: path.join(dir, 'data'),
    CACHE_DIR: path.join(dir, 'cache'),
    BACKUP_DIR: path.join(dir, 'backups'),
    DATABASE_URL: `file:${path.join(dir, 'data', 'test.db').replace(/\\/g, '/')}`,
    WEB_DIST: path.join(dir, 'no-web'),
    MDNS_ENABLED: 'false',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    MEDIA_ROOT: '',
    ...env,
  });
  const ctx = await createContext(config, pino({ level: 'silent' }));
  const app = await buildApp(ctx);
  await app.ready();

  const req: TestServer['req'] = (opts) => {
    const headers: Record<string, string> = {
      'x-taazastream': '1',
      ...(opts.headers as Record<string, string>),
    };
    if (opts.cookie) headers.cookie = opts.cookie;
    return app.inject({ ...opts, headers });
  };

  let cookie: string | null = null;
  const login = async () => {
    if (cookie) return cookie;
    const exists = await ctx.auth.adminExists();
    const res = await req({
      method: 'POST',
      url: exists ? '/api/auth/login' : '/api/auth/setup',
      payload: ADMIN,
    });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
    const set = res.headers['set-cookie'];
    cookie = (Array.isArray(set) ? set[0] : set)!.split(';')[0]!;
    return cookie;
  };

  return {
    app,
    ctx,
    dir,
    mediaDir,
    req,
    login,
    close: async () => {
      await app.close();
      await ctx.shutdown();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* Windows may hold a handle briefly */
      }
    },
  };
}

/** Adds the shared test media folder and runs a scan to completion. */
export async function seedLibrary(s: TestServer) {
  const cookie = await s.login();
  const add = await s.req({
    method: 'POST',
    url: '/api/admin/media-folders',
    cookie,
    payload: { path: s.mediaDir, kind: 'mixed' },
  });
  if (add.statusCode !== 200) throw new Error(add.body);
  return s.ctx.scanner.scanNow({});
}

export function json<T = unknown>(res: { body: string }): T {
  return (JSON.parse(res.body) as { data: T }).data;
}
