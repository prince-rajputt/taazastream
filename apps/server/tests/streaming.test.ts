import type { MovieDetail, Paged, PlaybackInfo, TitleCard } from '@taazastream/shared';
import { encodeCapabilities } from '@taazastream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, seedLibrary, startTestServer, type TestServer } from './helpers';

let s: TestServer;
let ids: Record<string, string>;

const chrome = encodeCapabilities({
  video: ['h264', 'vp9', 'av1'],
  audio: ['aac', 'mp3', 'opus'],
  containers: ['mp4', 'webm'],
  hls: 'mse',
});

beforeAll(async () => {
  s = await startTestServer();
  await seedLibrary(s);
  const movies = json<Paged<TitleCard>>(await s.req({ method: 'GET', url: '/api/movies' })).items;
  ids = Object.fromEntries(movies.map((m) => [m.title, m.videoId!]));
});
afterAll(async () => s?.close());

describe('HTTP Range streaming', () => {
  it('serves 206 partial content with correct headers', async () => {
    const res = await s.req({
      method: 'GET',
      url: `/api/stream/${ids['Test Voyage']}`,
      headers: { range: 'bytes=0-1023' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-length']).toBe('1024');
    expect(res.headers['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.rawPayload.length).toBe(1024);
  });

  it('supports seeking into the middle and the end of the file', async () => {
    const head = await s.req({ method: 'HEAD', url: `/api/stream/${ids['Test Voyage']}` });
    const size = Number(head.headers['content-length']);
    expect(size).toBeGreaterThan(10_000);
    const mid = await s.req({
      method: 'GET',
      url: `/api/stream/${ids['Test Voyage']}`,
      headers: { range: `bytes=${Math.floor(size / 2)}-` },
    });
    expect(mid.statusCode).toBe(206);
    expect(mid.rawPayload.length).toBe(size - Math.floor(size / 2));
    const tail = await s.req({
      method: 'GET',
      url: `/api/stream/${ids['Test Voyage']}`,
      headers: { range: 'bytes=-200' },
    });
    expect(tail.headers['content-range']).toBe(`bytes ${size - 200}-${size - 1}/${size}`);
  });

  it('returns 416 for unsatisfiable ranges', async () => {
    const res = await s.req({
      method: 'GET',
      url: `/api/stream/${ids['Test Voyage']}`,
      headers: { range: 'bytes=999999999-' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toMatch(/^bytes \*\/\d+$/);
  });

  it('serves the whole file without a Range header', async () => {
    const res = await s.req({ method: 'GET', url: `/api/stream/${ids['Test Voyage']}` });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(Number(res.headers['content-length']));
  });

  it('handles many concurrent range requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        s.req({
          method: 'GET',
          url: `/api/stream/${ids['Test Voyage']}`,
          headers: { range: `bytes=${i * 1000}-${i * 1000 + 999}` },
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 206 && r.rawPayload.length === 1000)).toBe(true);
  });

  it('enforces the concurrent stream limit for new viewers', async () => {
    const cookie = await s.login();
    // Allow exactly one more viewer than are already active from earlier tests.
    const limit = s.ctx.tracker.activeCount() + 1;
    await s.req({
      method: 'PATCH',
      url: '/api/admin/settings',
      cookie,
      payload: { maxStreams: limit },
    });
    try {
      await s.app.inject({
        method: 'GET',
        url: `/api/stream/${ids['Test Voyage']}`,
        headers: { range: 'bytes=0-9' },
        remoteAddress: '192.168.1.20',
      });
      const second = await s.app.inject({
        method: 'GET',
        url: `/api/stream/${ids['Dual Audio']}`,
        headers: { range: 'bytes=0-9' },
        remoteAddress: '192.168.1.21',
      });
      expect(second.statusCode).toBe(503);
      expect(JSON.parse(second.body).error.code).toBe('STREAM_LIMIT');
      // The existing viewer can keep seeking.
      const again = await s.app.inject({
        method: 'GET',
        url: `/api/stream/${ids['Test Voyage']}`,
        headers: { range: 'bytes=10-19' },
        remoteAddress: '192.168.1.20',
      });
      expect(again.statusCode).toBe(206);
    } finally {
      await s.req({
        method: 'PATCH',
        url: '/api/admin/settings',
        cookie,
        payload: { maxStreams: 8 },
      });
    }
  });
});

describe('path traversal & invalid ids', () => {
  it('never serves arbitrary paths', async () => {
    const attempts = [
      '/api/stream/..%2F..%2F..%2Fwindows%2Fwin.ini',
      '/api/stream/..\\..\\secret',
      '/api/images/..%2F..%2Fdata%2Ftest.db',
      '/api/images/..%5C..%5C.env',
      `/api/hls/${ids['Test Voyage']}/..%2F..%2F/index.m3u8`,
      `/api/hls/${ids['Test Voyage']}/t-720p-a0/..%2F..%2Ftest.db`,
      `/api/subtitles/${ids['Test Voyage']}/..%2F..%2Fx.vtt`,
    ];
    for (const url of attempts) {
      const res = await s.req({ method: 'GET', url });
      // Either rejected outright, or (for URLs the HTTP layer normalises, e.g. backslashes)
      // answered by the SPA shell. Never a file from disk.
      const type = String(res.headers['content-type'] ?? '');
      expect(
        res.statusCode === 400 || res.statusCode === 404 || type.startsWith('text/html'),
        `${url} -> ${res.statusCode}`,
      ).toBe(true);
      expect(type).not.toMatch(/^(video|image|application\/octet-stream)/);
      expect(res.body).not.toContain('SQLite format 3');
      expect(res.body).not.toContain('[fonts]');
    }
  });

  it('returns 404 for unknown and missing videos', async () => {
    expect((await s.req({ method: 'GET', url: '/api/stream/unknownvideo123' })).statusCode).toBe(
      404,
    );
    expect((await s.req({ method: 'GET', url: '/api/playback/unknownvideo123' })).statusCode).toBe(
      404,
    );
  });
});

describe('playback negotiation', () => {
  const play = async (title: string, query = '') =>
    json<PlaybackInfo>(
      await s.req({
        method: 'GET',
        url: `/api/playback/${ids[title]}?caps=${encodeURIComponent(chrome)}${query}`,
      }),
    );

  it('direct-plays compatible MP4', async () => {
    const p = await play('Test Voyage');
    expect(p).toMatchObject({
      mode: 'direct',
      isHls: false,
      url: `/api/stream/${ids['Test Voyage']}`,
    });
    expect(p.subtitles[0]?.url).toMatch(/\.vtt$/);
  });

  it('remuxes MKV without re-encoding', async () => {
    const p = await play('Dual Audio');
    expect(p.mode).toBe('remux');
    expect(p.audioTracks).toHaveLength(2);
  });

  it('transcodes HEVC for browsers without HEVC support', async () => {
    const p = await play('Heavy Codec');
    expect(p).toMatchObject({ mode: 'transcode', isHls: true });
  });

  it('switches to remux for an alternate audio track', async () => {
    const p = await play('Test Voyage', '&audio=0&quality=original');
    expect(p.mode).toBe('direct');
    const dual = await play('Dual Audio', '&audio=1');
    expect(dual.url).toContain('audio=1');
  });

  it('refuses corrupted files gracefully', async () => {
    const bad = await s.ctx.db.videoFile.findFirst({ where: { probeError: { not: null } } });
    const res = await s.req({ method: 'GET', url: `/api/playback/${bad!.id}` });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('MEDIA_UNREADABLE');
  });
});

describe('HLS', () => {
  it('remuxes to an HLS playlist with playable segments', async () => {
    const master = await s.req({
      method: 'GET',
      url: `/api/hls/${ids['Dual Audio']}/master.m3u8?mode=remux&audio=1&copy=1`,
    });
    expect(master.statusCode).toBe(200);
    expect(master.headers['content-type']).toContain('mpegurl');
    expect(master.body).toContain('r-c-a1/index.m3u8');
    const variant = await s.req({
      method: 'GET',
      url: `/api/hls/${ids['Dual Audio']}/r-c-a1/index.m3u8`,
    });
    expect(variant.statusCode).toBe(200);
    const seg = variant.body.split('\n').find((l) => l.startsWith('seg_'))!;
    const res = await s.req({ method: 'GET', url: `/api/hls/${ids['Dual Audio']}/r-c-a1/${seg}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp2t');
    expect(res.rawPayload[0]).toBe(0x47); // MPEG-TS sync byte
  });

  it('generates a seekable VOD playlist and transcodes segments on demand', async () => {
    const id = ids['Heavy Codec'];
    const master = await s.req({
      method: 'GET',
      url: `/api/hls/${id}/master.m3u8?mode=transcode&quality=480p`,
    });
    expect(master.body.split('\n').find((l) => l.endsWith('index.m3u8'))).toBe(
      't-480p-a0/index.m3u8',
    );
    const variant = await s.req({ method: 'GET', url: `/api/hls/${id}/t-480p-a0/index.m3u8` });
    expect(variant.body).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(variant.body).toContain('#EXT-X-ENDLIST');
    const segments = variant.body.split('\n').filter((l) => l.startsWith('seg_'));
    expect(segments.length).toBe(2); // 8s at 4s segments
    // Seek straight to the last segment (forces an encoder restart at that point).
    const last = await s.req({ method: 'GET', url: `/api/hls/${id}/t-480p-a0/${segments[1]}` });
    expect(last.statusCode).toBe(200);
    expect(last.rawPayload[0]).toBe(0x47);
    const first = await s.req({ method: 'GET', url: `/api/hls/${id}/t-480p-a0/${segments[0]}` });
    expect(first.statusCode).toBe(200);
    // Out-of-range segment
    expect(
      (await s.req({ method: 'GET', url: `/api/hls/${id}/t-480p-a0/seg_00099.ts` })).statusCode,
    ).toBe(404);
  });

  it('rejects malformed variants', async () => {
    expect(
      (await s.req({ method: 'GET', url: `/api/hls/${ids['Heavy Codec']}/t-4k-a0/index.m3u8` }))
        .statusCode,
    ).toBe(400);
  });
});

describe('subtitles', () => {
  it('serves sidecar SRT as WebVTT', async () => {
    const movie = json<Paged<TitleCard>>(
      await s.req({ method: 'GET', url: '/api/movies' }),
    ).items.find((m) => m.title === 'Test Voyage')!;
    const detail = json<MovieDetail>(
      await s.req({ method: 'GET', url: `/api/movies/${movie.id}` }),
    );
    const url = detail.videos[0]!.subtitles[0]!.url!;
    const res = await s.req({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/vtt');
    expect(res.body).toContain('WEBVTT');
    expect(res.body).toContain('Hello lighthouse');
  });
});
