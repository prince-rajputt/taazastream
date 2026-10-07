import { encodeCapabilities, type ClientCapabilities } from '@taazastream/shared';

let cached: ClientCapabilities | null = null;

function mse(type: string): boolean {
  try {
    const MS =
      (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ??
      window.MediaSource;
    return !!MS && MS.isTypeSupported(type);
  } catch {
    return false;
  }
}

function canPlay(video: HTMLVideoElement, type: string): boolean {
  try {
    return video.canPlayType(type) !== '';
  } catch {
    return false;
  }
}

/**
 * Ask the browser what it can decode so the server can choose direct play, a cheap remux
 * or a transcode. Results are cached for the session.
 */
export function detectCapabilities(): ClientCapabilities {
  if (cached) return cached;
  const v = document.createElement('video');
  const test = (type: string) => mse(type) || canPlay(v, type);

  const video: string[] = [];
  if (test('video/mp4; codecs="avc1.640028"') || test('video/mp4; codecs="avc1.42E01E"'))
    video.push('h264');
  if (test('video/mp4; codecs="hvc1.1.6.L120.90"') || test('video/mp4; codecs="hev1.1.6.L120.90"'))
    video.push('hevc');
  if (test('video/webm; codecs="vp9"') || test('video/mp4; codecs="vp09.00.10.08"'))
    video.push('vp9');
  if (test('video/webm; codecs="vp8"')) video.push('vp8');
  if (test('video/mp4; codecs="av01.0.05M.08"')) video.push('av1');

  const audio: string[] = [];
  if (test('audio/mp4; codecs="mp4a.40.2"')) audio.push('aac');
  if (test('audio/mpeg') || test('audio/mp4; codecs="mp3"')) audio.push('mp3');
  if (test('audio/webm; codecs="opus"') || test('audio/mp4; codecs="opus"')) audio.push('opus');
  if (test('audio/webm; codecs="vorbis"')) audio.push('vorbis');
  if (test('audio/flac') || test('audio/mp4; codecs="flac"')) audio.push('flac');
  if (test('audio/mp4; codecs="ac-3"')) audio.push('ac3');
  if (test('audio/mp4; codecs="ec-3"')) audio.push('eac3');

  const containers = ['mp4'];
  if (canPlay(v, 'video/webm')) containers.push('webm');

  const nativeHls = canPlay(v, 'application/vnd.apple.mpegurl');
  // Same test hls.js uses, without loading hls.js into the main bundle.
  const mseHls = mse('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
  const hls: ClientCapabilities['hls'] = mseHls
    ? nativeHls && isAppleWebKit()
      ? 'native'
      : 'mse'
    : nativeHls
      ? 'native'
      : 'none';

  if (!video.includes('h264')) video.push('h264'); // universally supported; some TVs under-report
  if (!audio.includes('aac')) audio.push('aac');

  cached = { video, audio, containers, hls };
  return cached;
}

export function capabilitiesParam(): string {
  return encodeCapabilities(detectCapabilities());
}

/** Safari/iOS: prefer the built-in HLS player (better battery, AirPlay, PiP). */
export function isAppleWebKit(): boolean {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|crios|chromium|android|edg/i.test(ua);
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}
