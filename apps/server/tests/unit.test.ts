import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/core/auth';
import { isForbiddenMediaRoot, isInside, joinInside, safeFileName } from '../src/core/paths';
import { parseProbe } from '../src/core/probe';
import {
  cleanTitle,
  parseMediaPath,
  parseSubtitleSidecar,
  sortTitleOf,
} from '../src/core/scanner/filename';
import { containerFamily } from '../src/core/scanner/scanner';
import { parseJsonSidecar, parseNfo } from '../src/core/scanner/sidecar';
import { toFtsQuery } from '../src/core/search';
import { parseVariantId, isSegmentName, variantId } from '../src/core/streaming/hls';
import { parseRange, videoMimeType } from '../src/core/streaming/range';
import { classifyUserAgent } from '../src/core/streaming/tracker';
import { srtToVtt } from '../src/core/subtitles';
import { isPrivateAddress } from '../src/core/system';

describe('HTTP Range parsing', () => {
  const size = 1000;
  it('returns full when no header', () =>
    expect(parseRange(undefined, size)).toEqual({ type: 'full' }));
  it('parses a closed range', () =>
    expect(parseRange('bytes=0-99', size)).toEqual({
      type: 'partial',
      range: { start: 0, end: 99 },
    }));
  it('parses an open range', () =>
    expect(parseRange('bytes=500-', size)).toEqual({
      type: 'partial',
      range: { start: 500, end: 999 },
    }));
  it('parses a suffix range', () =>
    expect(parseRange('bytes=-100', size)).toEqual({
      type: 'partial',
      range: { start: 900, end: 999 },
    }));
  it('clamps the end to the file size', () =>
    expect(parseRange('bytes=900-5000', size)).toEqual({
      type: 'partial',
      range: { start: 900, end: 999 },
    }));
  it('uses only the first of multiple ranges', () =>
    expect(parseRange('bytes=0-1,5-9', size)).toEqual({
      type: 'partial',
      range: { start: 0, end: 1 },
    }));
  it('rejects ranges beyond EOF', () =>
    expect(parseRange('bytes=1000-', size).type).toBe('unsatisfiable'));
  it('rejects inverted ranges', () =>
    expect(parseRange('bytes=50-10', size).type).toBe('unsatisfiable'));
  it('rejects garbage', () => expect(parseRange('bytes=abc', size).type).toBe('unsatisfiable'));
  it('ignores unknown units', () => expect(parseRange('items=0-5', size).type).toBe('full'));
  it('maps mime types', () => {
    expect(videoMimeType('a.mp4')).toBe('video/mp4');
    expect(videoMimeType('a.MKV')).toBe('video/x-matroska');
    expect(videoMimeType('a.webm')).toBe('video/webm');
  });
});

describe('path traversal protection', () => {
  const root = path.resolve('/media/movies');
  it('detects children', () => {
    expect(isInside(root, path.join(root, 'a', 'b.mp4'))).toBe(true);
    expect(isInside(root, root)).toBe(true);
  });
  it('rejects escapes', () => {
    expect(isInside(root, path.join(root, '..', 'secret.txt'))).toBe(false);
    expect(isInside(root, path.resolve('/media/movies-evil/x.mp4'))).toBe(false);
    expect(isInside(root, path.resolve('/etc/passwd'))).toBe(false);
  });
  it('validates URL file names', () => {
    expect(safeFileName('poster_abc_12ab34cd.webp')).toBe(true);
    for (const bad of [
      '../x.webp',
      '..\\x.webp',
      'a/b.webp',
      'C:x.webp',
      '.env',
      'x.webp\0',
      '%2e%2e.webp',
    ]) {
      expect(safeFileName(bad)).toBe(false);
    }
    expect(joinInside(root, '../../etc.webp')).toBeNull();
  });
  it('blocks system folders as media roots', () => {
    if (process.platform === 'win32') {
      expect(isForbiddenMediaRoot('C:\\Windows\\System32')).toBe(true);
      expect(isForbiddenMediaRoot('E:\\')).toBe(false);
      expect(isForbiddenMediaRoot('D:\\TaazaStream\\Movies')).toBe(false);
    } else {
      expect(isForbiddenMediaRoot('/etc')).toBe(true);
      expect(isForbiddenMediaRoot('/srv/media')).toBe(false);
    }
  });
});

describe('filename parsing', () => {
  it('parses "Title (Year)"', () => {
    expect(parseMediaPath('/m/Interstellar (2014)/Interstellar (2014).mkv')).toEqual({
      kind: 'movie',
      title: 'Interstellar',
      year: 2014,
    });
  });
  it('strips release noise', () => {
    expect(parseMediaPath('/m/The.Dark.Knight.2008.1080p.BluRay.x264-GRP.mkv')).toEqual({
      kind: 'movie',
      title: 'The Dark Knight',
      year: 2008,
    });
  });
  it('keeps numeric titles', () => {
    expect(parseMediaPath('/m/1917 (2019).mp4')).toMatchObject({ title: '1917', year: 2019 });
  });
  it('falls back to the folder name for generic files', () => {
    expect(parseMediaPath('/m/Arrival (2016)/movie.mkv')).toMatchObject({
      title: 'Arrival',
      year: 2016,
    });
  });
  it('parses SxxEyy episodes', () => {
    expect(parseMediaPath('/tv/Dark/Season 01/Dark S01E02 - Lies.mkv')).toEqual({
      kind: 'episode',
      seriesTitle: 'Dark',
      seasonNumber: 1,
      episodeNumber: 2,
      episodeTitle: 'Lies',
      year: null,
    });
  });
  it('parses 1x02 episodes', () => {
    expect(parseMediaPath('/tv/Show/Show.1x02.Name.mp4')).toMatchObject({
      kind: 'episode',
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });
  it('does not mistake resolutions for episodes', () => {
    expect(parseMediaPath('/m/Clip 1920x1080 (2010).mp4').kind).toBe('movie');
  });
  it('uses folder structure in series libraries', () => {
    expect(parseMediaPath('/tv/Planet/Season 2/Episode 5.mp4', 'series')).toMatchObject({
      seriesTitle: 'Planet',
      seasonNumber: 2,
      episodeNumber: 5,
    });
  });
  it('forces movies in movie libraries', () => {
    expect(parseMediaPath('/m/Show S01E01.mp4', 'movies').kind).toBe('movie');
  });
  it('builds sort titles', () => {
    expect(sortTitleOf('The Lord & the Rings!')).toBe('lord and the rings');
    expect(cleanTitle('the.matrix')).toBe('The Matrix');
  });
  it('parses sidecar subtitle names', () => {
    expect(parseSubtitleSidecar('Movie', 'Movie.en.srt')).toEqual({
      language: 'en',
      forced: false,
      isDefault: false,
    });
    expect(parseSubtitleSidecar('Movie', 'Movie.hi.forced.srt')).toEqual({
      language: 'hi',
      forced: true,
      isDefault: false,
    });
    expect(parseSubtitleSidecar('Movie', 'Other.en.srt')).toBeNull();
  });
  it('maps container families', () => {
    expect(containerFamily('matroska,webm', '.mkv')).toBe('mkv');
    expect(containerFamily('matroska,webm', '.webm')).toBe('webm');
    expect(containerFamily('mov,mp4,m4a,3gp,3g2,mj2', '.mp4')).toBe('mp4');
  });
});

describe('sidecar metadata', () => {
  it('parses Kodi .nfo', () => {
    const meta = parseNfo(
      '<movie><title>A &amp; B</title><year>2001</year><plot>Plot</plot><genre>Drama / Crime</genre><rating>8.25</rating><mpaa>Rated R</mpaa><actor><name>X</name><role>Y</role></actor></movie>',
    );
    expect(meta).toMatchObject({
      title: 'A & B',
      year: 2001,
      overview: 'Plot',
      genres: ['Drama', 'Crime'],
      rating: 8.3,
      contentRating: 'R',
      cast: [{ name: 'X', role: 'Y' }],
    });
  });
  it('parses JSON sidecars and rejects junk', () => {
    expect(parseJsonSidecar('{"title":"T","year":"1999","cast":["A"]}')).toMatchObject({
      title: 'T',
      year: 1999,
      cast: [{ name: 'A' }],
    });
    expect(parseJsonSidecar('not json')).toEqual({});
  });
});

describe('ffprobe parsing', () => {
  it('extracts video, audio and subtitle info', () => {
    const p = parseProbe({
      format: { format_name: 'matroska,webm', duration: '5400.5', bit_rate: '8000000' },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'hevc',
          width: 3840,
          height: 2160,
          pix_fmt: 'yuv420p10le',
          avg_frame_rate: '24000/1001',
        },
        { index: 1, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        {
          index: 2,
          codec_type: 'audio',
          codec_name: 'eac3',
          channels: 6,
          tags: { language: 'eng' },
        },
        {
          index: 3,
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          tags: { language: 'hin' },
          disposition: { default: 1 },
        },
        { index: 4, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
        { index: 5, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' },
      ],
    });
    expect(p).toMatchObject({
      videoCodec: 'hevc',
      height: 2160,
      bitDepth: 10,
      durationSec: 5400.5,
      fps: 23.976,
    });
    expect(p.audio.map((a) => [a.index, a.codec, a.isDefault])).toEqual([
      [0, 'eac3', false],
      [1, 'aac', true],
    ]);
    expect(p.subtitles.map((s) => s.textBased)).toEqual([true, false]);
  });
});

describe('subtitles', () => {
  it('converts SRT to WebVTT', () => {
    const vtt = srtToVtt(
      '\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color="red">Hi</font> <i>there</i>\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,000\r\nBye\r\n',
    );
    expect(vtt).toBe(
      'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHi <i>there</i>\n\n00:01:00.000 --> 00:01:02.000\nBye\n',
    );
  });
});

describe('passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('correct');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('misc', () => {
  it('builds safe FTS queries', () => {
    expect(toFtsQuery('Inter stel')).toBe('"inter"* "stel"*');
    expect(toFtsQuery('" OR 1=1 --')).toBe('"or"* "1"* "1"*');
    expect(toFtsQuery('!!!')).toBeNull();
  });
  it('validates HLS names', () => {
    expect(
      parseVariantId(variantId({ mode: 'transcode', quality: '720p', audioIndex: 1 })),
    ).toEqual({ mode: 'transcode', quality: '720p', audioIndex: 1 });
    expect(parseVariantId('r-c-a0')).toEqual({ mode: 'remux', copyAudio: true, audioIndex: 0 });
    expect(parseVariantId('../etc')).toBeNull();
    expect(isSegmentName('seg_00001.ts')).toBe(true);
    expect(isSegmentName('../seg_00001.ts')).toBe(false);
  });
  it('classifies devices and private IPs', () => {
    expect(classifyUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').type).toBe(
      'Phone',
    );
    expect(classifyUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)').type).toBe('TV');
    expect(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120').type).toBe(
      'Desktop',
    );
    expect(isPrivateAddress('192.168.1.5')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.2')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});
