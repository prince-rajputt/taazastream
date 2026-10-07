import type { Paged, TitleCard } from '@taazastream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, seedLibrary, startTestServer, type TestServer } from './helpers';

/**
 * Supabase configured but unreachable (as when the router has no internet):
 * every core feature must keep working in local-only mode.
 */
let s: TestServer;

beforeAll(async () => {
  s = await startTestServer({
    // RFC 5737 TEST-NET address: guaranteed unroutable.
    SUPABASE_URL: 'http://192.0.2.1:9',
    SUPABASE_ANON_KEY: 'public-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-never-exposed',
  });
  await seedLibrary(s);
});
afterAll(async () => s?.close());

describe('offline / Supabase unavailable', () => {
  it('reports local-only mode instead of failing', async () => {
    const status = await s.ctx.cloud.check();
    expect(status).toMatchObject({ configured: true, reachable: false, mode: 'local-only' });
    const health = json<{ status: string; mode: string }>(
      await s.req({ method: 'GET', url: '/api/health' }),
    );
    expect(health).toMatchObject({ status: 'ok', mode: 'local-only' });
  });

  it('keeps catalog, search, playback, progress and admin working', async () => {
    const movies = json<Paged<TitleCard>>(await s.req({ method: 'GET', url: '/api/movies' })).items;
    expect(movies.length).toBe(3);
    expect((await s.req({ method: 'GET', url: '/api/search?q=voyage' })).statusCode).toBe(200);
    const v = movies.find((m) => m.title === 'Test Voyage')!.videoId!;
    expect(
      (await s.req({ method: 'GET', url: `/api/stream/${v}`, headers: { range: 'bytes=0-99' } }))
        .statusCode,
    ).toBe(206);
    expect(
      (
        await s.req({
          method: 'POST',
          url: '/api/watch-progress?flush=1',
          payload: { videoId: v, positionSec: 30, durationSec: 100 },
        })
      ).statusCode,
    ).toBe(200);
    const cookie = await s.login();
    expect((await s.req({ method: 'GET', url: '/api/admin/stats', cookie })).statusCode).toBe(200);
  });

  it('cloud sync fails softly', async () => {
    const res = await s.ctx.cloud.sync();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('local-only');
  });

  it('never exposes the service role key through the API', async () => {
    const cookie = await s.login();
    for (const url of [
      '/api/admin/stats',
      '/api/admin/server',
      '/api/admin/cloud',
      '/api/admin/settings',
      '/api/health',
      '/api/connect',
    ]) {
      const res = await s.req({ method: 'GET', url, cookie });
      expect(res.body).not.toContain('service-role-key-never-exposed');
      expect(res.body).not.toContain('public-anon-key');
    }
  });
});
