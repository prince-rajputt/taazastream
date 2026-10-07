import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import type {
  AdminStats,
  ContinueWatchingItem,
  HomeFeed,
  MovieDetail,
  Paged,
  SearchResult,
  SeriesDetail,
  TitleCard,
} from '@taazastream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, json, seedLibrary, startTestServer, type TestServer } from './helpers';

let s: TestServer;
let movies: TitleCard[];

beforeAll(async () => {
  s = await startTestServer();
  const job = await seedLibrary(s);
  expect(job.status).toBe('completed');
  movies = json<Paged<TitleCard>>(await s.req({ method: 'GET', url: '/api/movies' })).items;
});
afterAll(async () => s?.close());

const byTitle = (t: string) => movies.find((m) => m.title === t)!;

describe('health', () => {
  it('reports ok and local-only mode', async () => {
    const res = await s.req({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string; mode: string; database: string }>(res)).toMatchObject({
      status: 'ok',
      mode: 'local-only',
      database: 'ok',
    });
  });
});

describe('media scanner', () => {
  it('indexes movies, series and episodes; flags corrupted files', async () => {
    const job = s.ctx.scanner.status!;
    expect(job.filesAdded).toBe(5);
    expect(job.filesFailed).toBe(1);
    expect(movies.map((m) => m.title).sort()).toEqual(['Dual Audio', 'Heavy Codec', 'Test Voyage']);
    const series = json<Paged<TitleCard>>(await s.req({ method: 'GET', url: '/api/series' })).items;
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ title: 'Signal Box', seasonCount: 1, episodeCount: 2 });
  });

  it('reads NFO metadata, codecs, audio tracks, subtitles and generates artwork', async () => {
    const m = json<MovieDetail>(
      await s.req({ method: 'GET', url: `/api/movies/${byTitle('Test Voyage').id}` }),
    );
    expect(m).toMatchObject({ year: 2020, rating: 7.7, genres: ['Adventure'] });
    expect(m.cast[0]?.name).toBe('Ravi Iyer');
    expect(m.backdropUrl).toMatch(/^\/api\/images\/backdrop_.+\.(webp|jpg)$/);
    const v = m.videos[0]!;
    expect(v).toMatchObject({ container: 'mp4', videoCodec: 'h264', height: 360 });
    expect(v.durationSec).toBeGreaterThan(9);
    expect(v.subtitles.map((x) => x.language)).toContain('en');
    const dual = json<MovieDetail>(
      await s.req({ method: 'GET', url: `/api/movies/${byTitle('Dual Audio').id}` }),
    );
    expect(dual.videos[0]!.audioTracks.map((a) => a.language)).toEqual(['eng', 'hin']);
    expect(dual.videos[0]!.container).toBe('mkv');
  });

  it('serves generated artwork with immutable caching', async () => {
    const url = byTitle('Test Voyage').backdropUrl!;
    const res = await s.req({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('detects deleted, restored and unchanged files on rescan', async () => {
    const file = path.join(s.mediaDir, 'Series/Signal Box/Season 01/Signal Box S01E02 - Relay.mp4');
    const hidden = `${file}.hidden`;
    renameSync(file, hidden);
    try {
      const job = await s.ctx.scanner.scanNow({});
      expect(job.filesRemoved).toBe(1);
      const series = json<Paged<TitleCard>>(
        await s.req({ method: 'GET', url: '/api/series' }),
      ).items;
      const detail = json<SeriesDetail>(
        await s.req({ method: 'GET', url: `/api/series/${series[0]!.id}` }),
      );
      expect(detail.seasons[0]!.episodes).toHaveLength(1);
    } finally {
      renameSync(hidden, file);
    }
    const job = await s.ctx.scanner.scanNow({});
    expect(job.filesRemoved).toBe(0);
    expect(job.filesAdded).toBe(0);
    expect(job.filesUpdated).toBe(1); // restored
    expect(existsSync(file)).toBe(true);
  });
});

describe('catalog & search', () => {
  it('builds the home feed', async () => {
    const home = json<HomeFeed>(await s.req({ method: 'GET', url: '/api/home' }));
    expect(home.libraryEmpty).toBe(false);
    expect(home.hero.length).toBeGreaterThan(0);
    const ids = home.rows.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(['trending', 'recent', 'movies', 'series', 'popular', 'new-releases']),
    );
  });

  it('searches title, year, cast, genre and description (FTS)', async () => {
    const q = async (term: string) =>
      json<SearchResult>(
        await s.req({ method: 'GET', url: `/api/search?q=${encodeURIComponent(term)}` }),
      ).items.map((i) => i.title);
    expect(await q('voy')).toEqual(['Test Voyage']);
    expect(await q('2020')).toContain('Test Voyage');
    expect(await q('ravi')).toContain('Test Voyage');
    expect(await q('adventure')).toContain('Test Voyage');
    expect(await q('lighthouse')).toContain('Test Voyage');
    expect(await q('signal')).toContain('Signal Box');
    expect(await q('zzzz')).toEqual([]);
    const sugg = json<{ title: string }[]>(
      await s.req({ method: 'GET', url: '/api/search/suggest?q=te' }),
    );
    expect(sugg.map((x) => x.title)).toContain('Test Voyage');
  });

  it('validates query input', async () => {
    const res = await s.req({ method: 'GET', url: `/api/search?q=${'x'.repeat(500)}` });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('manages My List per profile', async () => {
    const id = byTitle('Dual Audio').id;
    expect(
      (await s.req({ method: 'POST', url: '/api/my-list', payload: { kind: 'movie', id } }))
        .statusCode,
    ).toBe(200);
    expect(
      json<TitleCard[]>(await s.req({ method: 'GET', url: '/api/my-list' })).map((m) => m.id),
    ).toEqual([id]);
    await s.req({ method: 'DELETE', url: `/api/my-list/movie/${id}` });
    expect(json<TitleCard[]>(await s.req({ method: 'GET', url: '/api/my-list' }))).toEqual([]);
  });

  it('returns 404 envelopes for unknown ids', async () => {
    const res = await s.req({ method: 'GET', url: '/api/movies/doesnotexist' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Movie not found' },
    });
  });
});

describe('watch progress & continue watching', () => {
  it('buffers writes (debounced) and resumes', async () => {
    const videoId = byTitle('Test Voyage').videoId!;
    const before = s.ctx.progress.writes;
    for (const t of [16, 17, 18, 19, 20]) {
      await s.req({
        method: 'POST',
        url: '/api/watch-progress',
        payload: { videoId, positionSec: t, durationSec: 10.5 * 10, sessionId: 'abc' },
      });
    }
    // Nothing written yet: five reports were coalesced in memory.
    expect(s.ctx.progress.writes).toBe(before);
    const cw = json<ContinueWatchingItem[]>(
      await s.req({ method: 'GET', url: '/api/continue-watching' }),
    );
    expect(s.ctx.progress.writes).toBe(before + 1);
    expect(cw[0]).toMatchObject({ videoId, positionSec: 20, title: 'Test Voyage' });
    const detail = json<MovieDetail>(
      await s.req({ method: 'GET', url: `/api/movies/${byTitle('Test Voyage').id}` }),
    );
    expect(detail.progress?.positionSec).toBe(20);
  });

  it('marks completion and removes finished titles from Continue Watching', async () => {
    const videoId = byTitle('Test Voyage').videoId!;
    await s.req({
      method: 'POST',
      url: '/api/watch-progress?flush=1',
      payload: { videoId, positionSec: 104, durationSec: 105, sessionId: 'abc' },
    });
    const cw = json<ContinueWatchingItem[]>(
      await s.req({ method: 'GET', url: '/api/continue-watching' }),
    );
    expect(cw.find((c) => c.videoId === videoId)).toBeUndefined();
  });

  it('offers the next episode after finishing one', async () => {
    const series = json<Paged<TitleCard>>(await s.req({ method: 'GET', url: '/api/series' }))
      .items[0]!;
    const detail = json<SeriesDetail>(
      await s.req({ method: 'GET', url: `/api/series/${series.id}` }),
    );
    const [ep1, ep2] = detail.seasons[0]!.episodes;
    await s.req({
      method: 'POST',
      url: '/api/watch-progress?flush=1',
      payload: { videoId: ep1!.videoId, positionSec: 5, durationSec: 5, completed: true },
    });
    const cw = json<ContinueWatchingItem[]>(
      await s.req({ method: 'GET', url: '/api/continue-watching' }),
    );
    expect(cw.find((c) => c.titleId === series.id)).toMatchObject({
      videoId: ep2!.videoId,
      positionSec: 0,
    });
    const again = json<SeriesDetail>(
      await s.req({ method: 'GET', url: `/api/series/${series.id}` }),
    );
    expect(again.nextUp?.id).toBe(ep2!.id);
  });

  it('rejects invalid progress payloads', async () => {
    const res = await s.req({
      method: 'POST',
      url: '/api/watch-progress',
      payload: { videoId: '../x', positionSec: -5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('authentication & admin', () => {
  it('rejects admin APIs without a session', async () => {
    for (const url of ['/api/admin/stats', '/api/admin/devices', '/api/admin/settings']) {
      expect((await s.req({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await s.req({ method: 'POST', url: '/api/admin/scan', payload: {} })).statusCode).toBe(
      401,
    );
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const res = await s.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    expect(res.statusCode).toBe(403);
  });

  it('blocks admin APIs from public IPs', async () => {
    const cookie = await s.login();
    const res = await s.app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { cookie },
      remoteAddress: '203.0.113.9',
    });
    expect(res.statusCode).toBe(403);
  });

  it('only allows first-run setup from the server itself', async () => {
    const fresh = await startTestServer();
    try {
      const lan = await fresh.app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers: { 'x-taazastream': '1' },
        payload: ADMIN,
        remoteAddress: '192.168.1.40',
      });
      expect(lan.statusCode).toBe(403);
      const local = await fresh.req({ method: 'POST', url: '/api/auth/setup', payload: ADMIN });
      expect(local.statusCode).toBe(200);
      expect(String(local.headers['set-cookie'])).toMatch(/HttpOnly/i);
      expect(String(local.headers['set-cookie'])).toMatch(/SameSite=Strict/i);
      const again = await fresh.req({ method: 'POST', url: '/api/auth/setup', payload: ADMIN });
      expect(again.statusCode).toBe(409);
    } finally {
      await fresh.close();
    }
  });

  it('rejects wrong passwords and never stores plaintext', async () => {
    await s.login();
    const res = await s.req({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
    const user = await s.ctx.db.user.findUnique({ where: { username: 'admin' } });
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.passwordHash).not.toContain(ADMIN.password);
  });

  it('serves dashboard stats, devices and server info', async () => {
    const cookie = await s.login();
    const stats = json<AdminStats>(await s.req({ method: 'GET', url: '/api/admin/stats', cookie }));
    expect(stats.counts).toMatchObject({ movies: 3, series: 1, episodes: 2 });
    expect(stats.server.port).toBe(3000);
    expect(stats.system.memTotalBytes).toBeGreaterThan(0);
    expect(
      Array.isArray(json(await s.req({ method: 'GET', url: '/api/admin/devices', cookie }))),
    ).toBe(true);
  });

  it('edits movie metadata and keeps edits locked across rescans', async () => {
    const cookie = await s.login();
    const id = byTitle('Dual Audio').id;
    const res = await s.req({
      method: 'PATCH',
      url: `/api/admin/movies/${id}`,
      cookie,
      payload: { title: 'Two Voices', genres: ['Drama'], rating: 9.1, cast: [{ name: 'Meera' }] },
    });
    expect(res.statusCode).toBe(200);
    await s.ctx.scanner.scanNow({ full: true });
    const m = json<MovieDetail>(await s.req({ method: 'GET', url: `/api/movies/${id}` }));
    expect(m).toMatchObject({ title: 'Two Voices', rating: 9.1, genres: ['Drama'] });
    const found = json<SearchResult>(
      await s.req({ method: 'GET', url: '/api/search?q=meera' }),
    ).items.map((i) => i.id);
    expect(found).toContain(id);
  });

  it('validates media folder input', async () => {
    const cookie = await s.login();
    const missing = await s.req({
      method: 'POST',
      url: '/api/admin/media-folders',
      cookie,
      payload: { path: path.join(s.dir, 'nope') },
    });
    expect(missing.statusCode).toBe(400);
    const dupe = await s.req({
      method: 'POST',
      url: '/api/admin/media-folders',
      cookie,
      payload: { path: s.mediaDir },
    });
    expect(dupe.statusCode).toBe(409);
    const nested = await s.req({
      method: 'POST',
      url: '/api/admin/media-folders',
      cookie,
      payload: { path: path.join(s.mediaDir, 'Movies') },
    });
    expect(nested.statusCode).toBe(409);
  });

  it('creates and lists backups without video files', async () => {
    const cookie = await s.login();
    const created = json<{ fileName: string }[]>(
      await s.req({ method: 'POST', url: '/api/admin/backups', cookie }),
    );
    expect(created.map((b) => b.fileName.split('.').pop()).sort()).toEqual(['db', 'json']);
    const meta = await s.req({
      method: 'GET',
      url: `/api/admin/backups/${created.find((b) => b.fileName.endsWith('.json'))!.fileName}`,
      cookie,
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.body).toContain('taazastream-metadata');
    expect(
      (await s.req({ method: 'GET', url: '/api/admin/backups/..%2F..%2F.env', cookie })).statusCode,
    ).toBe(404);
  });

  it('updates settings with validation', async () => {
    const cookie = await s.login();
    expect(
      (
        await s.req({
          method: 'PATCH',
          url: '/api/admin/settings',
          cookie,
          payload: { maxStreams: 0 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.req({
          method: 'PATCH',
          url: '/api/admin/settings',
          cookie,
          payload: { ffmpegPath: 'C:\\nope\\ffmpeg.exe' },
        })
      ).statusCode,
    ).toBe(400);
    const ok = json<{ maxStreams: number }>(
      await s.req({
        method: 'PATCH',
        url: '/api/admin/settings',
        cookie,
        payload: { maxStreams: 6 },
      }),
    );
    expect(ok.maxStreams).toBe(6);
  });

  it('deletes database entries without touching files', async () => {
    const cookie = await s.login();
    const target = byTitle('Heavy Codec');
    const detail = json<MovieDetail>(
      await s.req({ method: 'GET', url: `/api/movies/${target.id}` }),
    );
    const res = await s.req({ method: 'DELETE', url: `/api/admin/movies/${target.id}`, cookie });
    expect(res.statusCode).toBe(200);
    expect((await s.req({ method: 'GET', url: `/api/movies/${target.id}` })).statusCode).toBe(404);
    expect(existsSync(path.join(s.mediaDir, 'Movies', detail.videos[0]!.fileName))).toBe(true);
    await s.ctx.scanner.scanNow({});
    movies = json<Paged<TitleCard>>(await s.req({ method: 'GET', url: '/api/movies' })).items;
    expect(movies.map((m) => m.title)).toContain('Heavy Codec');
  });
});
