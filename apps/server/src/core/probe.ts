/**
 * Converts raw ffprobe JSON into the compact metadata TaazaStream stores.
 */

export interface ProbedAudio {
  index: number;
  streamIndex: number;
  codec: string;
  language: string | null;
  title: string | null;
  channels: number | null;
  isDefault: boolean;
}

export interface ProbedSubtitle {
  streamIndex: number;
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  forced: boolean;
  /** Text based subtitles can be converted to WebVTT; bitmap ones (PGS/VobSub) cannot. */
  textBased: boolean;
}

export interface MediaProbe {
  container: string | null;
  durationSec: number;
  bitrate: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  videoProfile: string | null;
  pixFmt: string | null;
  bitDepth: number | null;
  fps: number | null;
  audio: ProbedAudio[];
  subtitles: ProbedSubtitle[];
  title: string | null;
}

interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

interface RawProbe {
  streams?: RawStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'subviewer']);

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [a, b] = rate.split('/').map(Number);
  if (!a || !b) return null;
  const fps = a / b;
  return fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : null;
}

function tag(tags: Record<string, string> | undefined, key: string): string | null {
  if (!tags) return null;
  const found = Object.entries(tags).find(([k]) => k.toLowerCase() === key);
  const v = found?.[1]?.trim();
  return v ? v : null;
}

function language(tags: Record<string, string> | undefined): string | null {
  const l = tag(tags, 'language');
  return l && l !== 'und' ? l.toLowerCase() : null;
}

export function bitDepthFromPixFmt(pixFmt: string | null, raw?: string): number | null {
  const fromRaw = num(raw);
  if (fromRaw && fromRaw > 0) return fromRaw;
  if (!pixFmt) return null;
  const m = /p(\d{2})(le|be)?$/.exec(pixFmt);
  if (m?.[1]) return Number(m[1]);
  return 8;
}

export function parseProbe(json: unknown): MediaProbe {
  const raw = (json ?? {}) as RawProbe;
  const streams = raw.streams ?? [];
  const video = streams.find(
    (s) => s.codec_type === 'video' && !s.disposition?.attached_pic && s.codec_name !== 'mjpeg' && s.codec_name !== 'png',
  );

  let audioIdx = 0;
  const audio: ProbedAudio[] = streams
    .filter((s) => s.codec_type === 'audio')
    .map((s) => ({
      index: audioIdx++,
      streamIndex: s.index ?? 0,
      codec: s.codec_name ?? 'unknown',
      language: language(s.tags),
      title: tag(s.tags, 'title'),
      channels: s.channels ?? null,
      isDefault: s.disposition?.default === 1,
    }));
  if (audio.length > 0 && !audio.some((a) => a.isDefault)) audio[0]!.isDefault = true;

  const subtitles: ProbedSubtitle[] = streams
    .filter((s) => s.codec_type === 'subtitle')
    .map((s) => ({
      streamIndex: s.index ?? 0,
      codec: s.codec_name ?? 'unknown',
      language: language(s.tags),
      title: tag(s.tags, 'title'),
      isDefault: s.disposition?.default === 1,
      forced: s.disposition?.forced === 1,
      textBased: TEXT_SUBTITLE_CODECS.has(s.codec_name ?? ''),
    }));

  const duration = num(raw.format?.duration) ?? num(video?.duration) ?? 0;
  const pixFmt = video?.pix_fmt ?? null;

  return {
    container: raw.format?.format_name ?? null,
    durationSec: duration > 0 ? duration : 0,
    bitrate: num(raw.format?.bit_rate) != null ? Math.round(num(raw.format?.bit_rate)!) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    videoProfile: video?.profile ?? null,
    pixFmt,
    bitDepth: video ? bitDepthFromPixFmt(pixFmt, video.bits_per_raw_sample) : null,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    audio,
    subtitles,
    title: tag(raw.format?.tags, 'title'),
  };
}
