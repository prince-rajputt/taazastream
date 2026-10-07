import type { ClientCapabilities, PlaybackMode, QualityId, QualityOption } from './types';

/**
 * Quality ladder used for HLS transcoding. Bitrates are tuned for home Wi-Fi:
 * high enough to look good on a TV, low enough for several concurrent viewers.
 */
export const QUALITY_PRESETS: Record<Exclude<QualityId, 'original'>, QualityPreset> = {
  '1080p': {
    id: '1080p',
    height: 1080,
    width: 1920,
    videoKbps: 6000,
    maxrateKbps: 7500,
    audioKbps: 192,
  },
  '720p': {
    id: '720p',
    height: 720,
    width: 1280,
    videoKbps: 3000,
    maxrateKbps: 3800,
    audioKbps: 160,
  },
  '480p': {
    id: '480p',
    height: 480,
    width: 854,
    videoKbps: 1400,
    maxrateKbps: 1800,
    audioKbps: 128,
  },
};

export interface QualityPreset {
  id: Exclude<QualityId, 'original'>;
  height: number;
  width: number;
  videoKbps: number;
  maxrateKbps: number;
  audioKbps: number;
}

/** Codecs every modern browser can decode natively. Used when the client sends no capabilities. */
export const BASELINE_CAPABILITIES: ClientCapabilities = {
  video: ['h264'],
  audio: ['aac', 'mp3'],
  containers: ['mp4'],
  hls: 'mse',
};

/** Map file extensions / ffprobe format names to the container families browsers understand. */
export function normalizeContainer(container: string | null | undefined): string | null {
  if (!container) return null;
  const c = container.toLowerCase();
  if (c.includes('mp4') || c.includes('mov') || c.includes('m4v') || c.includes('3gp'))
    return 'mp4';
  // ffprobe reports "matroska,webm" for both; the scanner stores the real family ("webm"/"mkv").
  if (c.includes('matroska') || c === 'mkv') return 'mkv';
  if (c.includes('webm')) return 'webm';
  if (c.includes('avi')) return 'avi';
  if (c.includes('mpegts') || c === 'ts' || c === 'm2ts') return 'mpegts';
  if (c.includes('flv')) return 'flv';
  if (c.includes('asf') || c === 'wmv') return 'wmv';
  if (c.includes('ogg') || c === 'ogv') return 'ogg';
  if (c.includes('mpeg')) return 'mpeg';
  return c;
}

/** Normalise ffprobe codec names to the identifiers used in client capabilities. */
export function normalizeCodec(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const c = codec.toLowerCase();
  if (c === 'h264' || c === 'avc' || c === 'avc1') return 'h264';
  if (c === 'hevc' || c === 'h265' || c === 'hvc1' || c === 'hev1') return 'hevc';
  if (c === 'vp09' || c === 'vp9') return 'vp9';
  if (c === 'vp8') return 'vp8';
  if (c === 'av1' || c === 'av01') return 'av1';
  if (c === 'aac' || c.startsWith('mp4a')) return 'aac';
  if (c === 'mp3' || c === 'mp3float') return 'mp3';
  if (c === 'opus') return 'opus';
  if (c === 'vorbis') return 'vorbis';
  if (c === 'flac') return 'flac';
  if (c === 'ac3') return 'ac3';
  if (c === 'eac3') return 'eac3';
  if (c.startsWith('dts') || c === 'dca') return 'dts';
  if (c === 'truehd') return 'truehd';
  if (c.startsWith('pcm_')) return 'pcm';
  return c;
}

/** Audio codecs that may be stream-copied into an HLS (MPEG-TS) segment and still play in browsers. */
const HLS_COPYABLE_AUDIO = new Set(['aac', 'mp3', 'ac3', 'eac3']);

export interface PlaybackSource {
  container: string | null;
  videoCodec: string | null;
  bitDepth: number | null;
  height: number | null;
  /** Codec of every audio track, in stream order. */
  audioCodecs: string[];
  /** Index of the track flagged as default by the file (usually 0). */
  defaultAudioIndex: number;
}

export interface PlaybackRequest {
  quality: QualityId;
  audioIndex: number;
}

export interface PlaybackDecision {
  mode: PlaybackMode;
  reason: string;
  /** For remux: whether the audio stream can be copied rather than re-encoded to AAC. */
  copyAudio: boolean;
  quality: QualityId;
}

/**
 * The heart of "do NOT blindly transcode":
 *
 *   video ─► ffprobe ─► compatible? ─┬─ yes ─► direct HTTP range streaming
 *                                    ├─ codecs ok, container not ─► remux to HLS (copy, ~0 CPU)
 *                                    └─ no ─► FFmpeg HLS transcode
 */
export function decidePlayback(
  source: PlaybackSource,
  caps: ClientCapabilities,
  req: PlaybackRequest,
): PlaybackDecision {
  const container = normalizeContainer(source.container);
  const video = normalizeCodec(source.videoCodec);
  const audioIndex = clampIndex(
    req.audioIndex,
    source.audioCodecs.length,
    source.defaultAudioIndex,
  );
  const audio = normalizeCodec(source.audioCodecs[audioIndex] ?? null);
  const hlsAvailable = caps.hls !== 'none';

  // An explicit lower quality always needs an encode.
  if (req.quality !== 'original') {
    const preset = QUALITY_PRESETS[req.quality];
    if (source.height == null || preset.height < source.height - 8) {
      return {
        mode: 'transcode',
        reason: `Transcoding to ${req.quality} as requested`,
        copyAudio: false,
        quality: req.quality,
      };
    }
  }

  const videoOk =
    video != null &&
    caps.video.includes(video) &&
    // 10-bit H.264 (Hi10P) is not decodable by browsers even though the codec name matches.
    !(video === 'h264' && (source.bitDepth ?? 8) > 8);
  const audioOk = audio == null || caps.audio.includes(audio);
  const containerOk = container != null && caps.containers.includes(container);
  const nonDefaultAudio = source.audioCodecs.length > 1 && audioIndex !== source.defaultAudioIndex;

  if (videoOk && audioOk && containerOk && !nonDefaultAudio) {
    return {
      mode: 'direct',
      reason: `Direct play (${container}/${video}${audio ? `/${audio}` : ''})`,
      copyAudio: true,
      quality: 'original',
    };
  }

  if (!hlsAvailable) {
    // Nothing better available: try the original file and let the browser do its best.
    return {
      mode: 'direct',
      reason: 'Direct play (browser has no HLS support)',
      copyAudio: true,
      quality: 'original',
    };
  }

  if (videoOk) {
    const copyAudio = audio == null || (audioOk && HLS_COPYABLE_AUDIO.has(audio));
    const why = nonDefaultAudio
      ? 'alternate audio track selected'
      : !containerOk
        ? `${container ?? 'unknown'} container not supported by this browser`
        : `${audio} audio not supported by this browser`;
    return {
      mode: 'remux',
      reason: `Remux to HLS – ${why}; video copied without re-encoding`,
      copyAudio,
      quality: 'original',
    };
  }

  const target = pickTranscodeQuality(source.height, req.quality);
  return {
    mode: 'transcode',
    reason: `Transcoding – ${video ?? 'unknown'}${
      video === 'h264' && (source.bitDepth ?? 8) > 8 ? ' 10-bit' : ''
    } video not supported by this browser`,
    copyAudio: false,
    quality: target,
  };
}

function clampIndex(i: number, length: number, fallback: number): number {
  if (length === 0) return 0;
  if (Number.isInteger(i) && i >= 0 && i < length) return i;
  return Math.min(Math.max(fallback, 0), length - 1);
}

/** Highest preset that does not upscale the source. */
export function pickTranscodeQuality(sourceHeight: number | null, requested: QualityId): QualityId {
  if (requested !== 'original') return requested;
  const h = sourceHeight ?? 1080;
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  return '480p';
}

/** Quality menu entries offered for a source of the given height. */
export function qualityOptionsFor(sourceHeight: number | null): QualityOption[] {
  const options: QualityOption[] = [{ id: 'original', label: 'Original', height: sourceHeight }];
  for (const preset of Object.values(QUALITY_PRESETS)) {
    if (sourceHeight == null || preset.height < sourceHeight - 8) {
      options.push({ id: preset.id, label: preset.id, height: preset.height });
    }
  }
  return options;
}

export function encodeCapabilities(caps: ClientCapabilities): string {
  return [caps.video.join(','), caps.audio.join(','), caps.containers.join(','), caps.hls].join(
    '|',
  );
}

export function decodeCapabilities(value: string | undefined | null): ClientCapabilities {
  if (!value) return BASELINE_CAPABILITIES;
  const [video = '', audio = '', containers = '', hls = 'mse'] = value.split('|');
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => /^[a-z0-9]{2,12}$/.test(x))
      .slice(0, 16);
  return {
    video: list(video),
    audio: list(audio),
    containers: list(containers),
    hls: hls === 'native' || hls === 'none' ? hls : 'mse',
  };
}
