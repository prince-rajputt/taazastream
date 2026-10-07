import { describe, expect, it } from 'vitest';
import {
  decidePlayback,
  decodeCapabilities,
  encodeCapabilities,
  qualityOptionsFor,
  type PlaybackSource,
} from '../src/playback';
import { formatRuntime, formatTimecode, isWatched, slugify } from '../src/format';
import type { ClientCapabilities } from '../src/types';

const chrome: ClientCapabilities = {
  video: ['h264', 'vp9', 'av1', 'vp8'],
  audio: ['aac', 'mp3', 'opus', 'vorbis', 'flac'],
  containers: ['mp4', 'webm'],
  hls: 'mse',
};

const mp4: PlaybackSource = {
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  videoCodec: 'h264',
  bitDepth: 8,
  height: 1080,
  audioCodecs: ['aac'],
  defaultAudioIndex: 0,
};

const original = { quality: 'original' as const, audioIndex: 0 };

describe('decidePlayback', () => {
  it('direct-plays a compatible MP4', () => {
    expect(decidePlayback(mp4, chrome, original).mode).toBe('direct');
  });

  it('remuxes MKV with compatible codecs instead of transcoding', () => {
    const d = decidePlayback({ ...mp4, container: 'matroska,webm' }, chrome, original);
    expect(d.mode).toBe('remux');
    expect(d.copyAudio).toBe(true);
  });

  it('remuxes and re-encodes audio when the browser cannot decode DTS', () => {
    const d = decidePlayback({ ...mp4, audioCodecs: ['dts'] }, chrome, original);
    expect(d.mode).toBe('remux');
    expect(d.copyAudio).toBe(false);
  });

  it('remuxes when an alternate audio track is chosen', () => {
    const d = decidePlayback({ ...mp4, audioCodecs: ['aac', 'aac'] }, chrome, {
      quality: 'original',
      audioIndex: 1,
    });
    expect(d.mode).toBe('remux');
  });

  it('transcodes HEVC for browsers without HEVC', () => {
    const d = decidePlayback({ ...mp4, videoCodec: 'hevc' }, chrome, original);
    expect(d.mode).toBe('transcode');
    expect(d.quality).toBe('1080p');
  });

  it('direct-plays HEVC where the browser supports it', () => {
    const safari = { ...chrome, video: [...chrome.video, 'hevc'], hls: 'native' as const };
    expect(decidePlayback({ ...mp4, videoCodec: 'hevc' }, safari, original).mode).toBe('direct');
  });

  it('transcodes 10-bit H.264', () => {
    expect(decidePlayback({ ...mp4, bitDepth: 10 }, chrome, original).mode).toBe('transcode');
  });

  it('transcodes when a lower quality is requested', () => {
    const d = decidePlayback(mp4, chrome, { quality: '720p', audioIndex: 0 });
    expect(d).toMatchObject({ mode: 'transcode', quality: '720p' });
  });

  it('does not upscale: a 720p request on a 720p source plays directly', () => {
    expect(
      decidePlayback({ ...mp4, height: 720 }, chrome, { quality: '720p', audioIndex: 0 }).mode,
    ).toBe('direct');
  });

  it('falls back to direct when the client has no HLS support', () => {
    expect(
      decidePlayback({ ...mp4, container: 'matroska' }, { ...chrome, hls: 'none' }, original).mode,
    ).toBe('direct');
  });
});

describe('capabilities encoding', () => {
  it('round-trips and sanitises', () => {
    expect(decodeCapabilities(encodeCapabilities(chrome))).toEqual(chrome);
    expect(decodeCapabilities('h264,<script>|aac|mp4|evil').video).toEqual(['h264']);
    expect(decodeCapabilities('h264|aac|mp4|evil').hls).toBe('mse');
  });
});

describe('quality options', () => {
  it('never offers upscaled variants', () => {
    expect(qualityOptionsFor(720).map((q) => q.id)).toEqual(['original', '480p']);
    expect(qualityOptionsFor(2160).map((q) => q.id)).toEqual(['original', '1080p', '720p', '480p']);
  });
});

describe('format helpers', () => {
  it('formats timecodes', () => {
    expect(formatTimecode(4363)).toBe('1:12:43');
    expect(formatTimecode(95)).toBe('1:35');
  });
  it('formats runtimes', () => {
    expect(formatRuntime(8040)).toBe('2h 14m');
    expect(formatRuntime(2700)).toBe('45m');
  });
  it('detects watched', () => {
    expect(isWatched(5900, 6000)).toBe(true);
    expect(isWatched(100, 6000)).toBe(false);
  });
  it('slugifies', () => {
    expect(slugify('Sci-Fi & Fantasy')).toBe('sci-fi-and-fantasy');
  });
});
