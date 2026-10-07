import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import {
  BASELINE_CAPABILITIES,
  QUALITY_PRESETS,
  decidePlayback,
  decodeCapabilities,
  idSchema,
  playbackQuerySchema,
  qualityOptionsFor,
  qualitySchema,
  videoIdParamsSchema,
  type PlaybackInfo,
  type PlaybackMode,
  type QualityId,
} from '@taazastream/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { LocalImageServer } from '../core/images';
import { isSegmentName, parseVariantId, type HlsSource, type VariantSpec } from '../core/streaming/hls';
import { StreamTracker } from '../core/streaming/tracker';
import { AppError, notFound, ok } from '../http/errors';
import { parse } from '../http/validate';

const videoInclude = {
  folder: { select: { path: true } },
  audioTracks: { orderBy: { index: 'asc' } },
  subtitles: true,
  movie: { select: { id: true, title: true, backdropImage: true } },
  episode: {
    select: {
      id: true,
      number: true,
      title: true,
      thumbImage: true,
      season: { select: { number: true } },
      series: { select: { id: true, title: true, backdropImage: true } },
    },
  },
} satisfies Prisma.VideoFileInclude;

type VideoRow = Prisma.VideoFileGetPayload<{ include: typeof videoInclude }>;

/** Tiny TTL cache: a playing HLS stream asks for the same video every few seconds. */
class VideoCache {
  private map = new Map<string, { at: number; v: VideoRow }>();
  get(id: string) {
    const hit = this.map.get(id);
    if (hit && Date.now() - hit.at < 15_000) return hit.v;
    this.map.delete(id);
    return undefined;
  }
  set(id: string, v: VideoRow) {
    if (this.map.size > 500) this.map.clear();
    this.map.set(id, { at: Date.now(), v });
  }
}

function titleOf(v: VideoRow): { title: string; subtitle: string | null; titleId: string; kind: 'movie' | 'series'; backdrop: string | null } {
  if (v.episode) {
    return {
      title: v.episode.series.title,
      subtitle: `S${v.episode.season.number} E${v.episode.number} · ${v.episode.title}`,
      titleId: v.episode.series.id,
      kind: 'series',
      backdrop: v.episode.thumbImage ?? v.episode.series.backdropImage ?? v.thumbImage,
    };
  }
  return { title: v.movie?.title ?? v.fileName, subtitle: null, titleId: v.movie?.id ?? '', kind: 'movie', backdrop: v.movie?.backdropImage ?? v.thumbImage };
}

function hlsSource(v: VideoRow): HlsSource {
  return {
    id: v.id,
    path: v.path,
    sizeBytes: Number(v.sizeBytes),
    mtimeMs: v.mtimeMs,
    durationSec: v.durationSec,
    height: v.height,
    videoCodec: v.videoCodec,
    audioCodecs: v.audioTracks.map((a) => a.codec),
  };
}

function ownerOf(request: FastifyRequest): string {
  return StreamTracker.key(request.ip, request.headers['user-agent'], 'hls');
}

const M3U8 = 'application/vnd.apple.mpegurl';

export function registerPlaybackRoutes(app: FastifyInstance, ctx: AppContext) {
  const cache = new VideoCache();

  async function loadVideo(id: string, opts: { allowMissing?: boolean } = {}): Promise<VideoRow> {
    let v = cache.get(id);
    if (!v) {
      const row = await ctx.db.videoFile.findUnique({ where: { id }, include: videoInclude });
      if (!row) throw notFound('Video');
      v = row;
      cache.set(id, v);
    }
    if (v.missing && !opts.allowMissing) throw new AppError(404, 'MEDIA_MISSING', 'This video file is missing from the server disk');
    return v;
  }

  /** Playback negotiation: direct play when possible, otherwise remux, otherwise transcode. */
  app.get('/api/playback/:videoId', async (request) => {
    const { videoId } = parse(videoIdParamsSchema, request.params);
    const q = parse(playbackQuerySchema, request.query);
    const v = await loadVideo(videoId);
    if (v.probeError) throw new AppError(422, 'MEDIA_UNREADABLE', 'This video file appears to be corrupted or unsupported');

    const caps = q.caps ? decodeCapabilities(q.caps) : BASELINE_CAPABILITIES;
    const defaultAudioIndex = Math.max(0, v.audioTracks.findIndex((a) => a.isDefault));
    const audioIndex = q.audio != null && q.audio < v.audioTracks.length ? q.audio : defaultAudioIndex;
    const quality: QualityId = q.quality ?? ctx.settings.get().defaultQuality;
    let decision = decidePlayback(
      {
        container: v.container,
        videoCodec: v.videoCodec,
        bitDepth: v.bitDepth,
        height: v.height,
        audioCodecs: v.audioTracks.map((a) => a.codec),
        defaultAudioIndex,
      },
      caps,
      { quality, audioIndex },
    );
    if (decision.mode !== 'direct' && !ctx.ffmpeg.ffmpeg.available) {
      decision = { mode: 'direct', reason: 'Direct play (FFmpeg not installed on server — conversion unavailable)', copyAudio: true, quality: 'original' };
    }

    let url = `/api/stream/${v.id}`;
    if (decision.mode === 'remux') {
      url = `/api/hls/${v.id}/master.m3u8?mode=remux&audio=${audioIndex}&copy=${decision.copyAudio ? 1 : 0}`;
    } else if (decision.mode === 'transcode') {
      url = `/api/hls/${v.id}/master.m3u8?mode=transcode&audio=${audioIndex}&quality=${decision.quality}`;
    }

    const t = titleOf(v);
    const next = v.episode ? await ctx.catalog.nextEpisode(v.episode.id) : null;
    const info: PlaybackInfo = {
      videoId: v.id,
      mode: decision.mode,
      reason: decision.reason,
      url,
      isHls: decision.mode !== 'direct',
      title: t.title,
      subtitle: t.subtitle,
      durationSec: v.durationSec,
      resumeSec: await ctx.progress.resumePosition(request.profileId, v.id),
      backdropUrl: LocalImageServer.urlFor(t.backdrop),
      qualities: qualityOptionsFor(v.height),
      quality: decision.quality,
      audioTracks: v.audioTracks.map((a) => ({ index: a.index, codec: a.codec, language: a.language, title: a.title, channels: a.channels, isDefault: a.isDefault })),
      audioIndex,
      subtitles: ctx.catalog.videoInfo({ ...v, audioTracks: v.audioTracks, subtitles: v.subtitles }).subtitles,
      next: next
        ? {
            episodeId: next.episode.id,
            videoId: next.videoId,
            title: next.episode.title,
            seasonNumber: next.episode.season.number,
            episodeNumber: next.episode.number,
            thumbUrl: LocalImageServer.urlFor(next.episode.thumbImage),
          }
        : null,
      titleId: t.titleId,
      kind: t.kind,
    };
    return ok(info);
  });

  /* ------------------------------ Direct streaming ------------------------------ */
  const streamHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { videoId } = parse(videoIdParamsSchema, request.params);
    const v = await loadVideo(videoId);
    const t = titleOf(v);
    return ctx.streamer.stream(request, reply, {
      id: v.id,
      path: v.path,
      fileName: v.fileName,
      title: t.subtitle ? `${t.title} — ${t.subtitle}` : t.title,
      folderPath: v.folder.path,
    });
  };
  // Fastify also exposes HEAD for this GET route automatically.
  app.get('/api/stream/:videoId', streamHandler);

  /* ------------------------------ HLS ------------------------------ */
  const masterQuery = z.object({
    mode: z.enum(['remux', 'transcode']).optional(),
    quality: qualitySchema.optional(),
    audio: z.coerce.number().int().min(0).max(64).optional(),
    copy: z.enum(['0', '1']).optional(),
  });

  app.get('/api/hls/:videoId/master.m3u8', async (request, reply) => {
    const { videoId } = parse(videoIdParamsSchema, request.params);
    const q = parse(masterQuery, request.query);
    const v = await loadVideo(videoId);
    if (!ctx.ffmpeg.ffmpeg.available) throw new AppError(503, 'TRANSCODER_UNAVAILABLE', 'FFmpeg is not installed on the server');
    const audioIndex = q.audio != null && q.audio < v.audioTracks.length ? q.audio : Math.max(0, v.audioTracks.findIndex((a) => a.isDefault));

    // Without an explicit mode, apply the same rules as /api/playback for a baseline browser.
    let mode: Exclude<PlaybackMode, 'direct'> = q.mode ?? 'transcode';
    let copyAudio = q.copy === '1';
    if (!q.mode) {
      const d = decidePlayback(
        { container: v.container, videoCodec: v.videoCodec, bitDepth: v.bitDepth, height: v.height, audioCodecs: v.audioTracks.map((a) => a.codec), defaultAudioIndex: audioIndex },
        { ...BASELINE_CAPABILITIES, containers: [] },
        { quality: q.quality ?? 'original', audioIndex },
      );
      mode = d.mode === 'transcode' ? 'transcode' : 'remux';
      copyAudio = d.copyAudio;
    }

    let variants: VariantSpec[];
    if (mode === 'remux') {
      variants = [{ mode: 'remux', copyAudio, audioIndex }];
    } else {
      const ladder = (Object.keys(QUALITY_PRESETS) as (keyof typeof QUALITY_PRESETS)[]).filter(
        (k) => v.height == null || QUALITY_PRESETS[k].height <= Math.max(v.height + 8, 480),
      );
      const start = q.quality && q.quality !== 'original' && ladder.includes(q.quality) ? q.quality : ladder[0]!;
      // The requested quality first: players start with the first listed variant.
      variants = [start, ...ladder.filter((k) => k !== start)].map((quality) => ({ mode: 'transcode' as const, quality, audioIndex }));
    }
    reply.header('Content-Type', M3U8).header('Cache-Control', 'no-cache');
    return reply.send(ctx.hls.masterPlaylist(hlsSource(v), variants));
  });

  const variantParams = z.object({ videoId: idSchema, variant: z.string().max(32) });

  app.get('/api/hls/:videoId/:variant/index.m3u8', async (request, reply) => {
    const { videoId, variant } = parse(variantParams, request.params);
    const spec = parseVariantId(variant);
    if (!spec) throw new AppError(400, 'BAD_REQUEST', 'Invalid variant');
    const v = await loadVideo(videoId);
    if (spec.audioIndex > 0 && spec.audioIndex >= v.audioTracks.length) throw new AppError(400, 'BAD_REQUEST', 'Invalid audio track');
    const t = titleOf(v);
    ctx.tracker.record({
      ip: request.ip,
      ua: request.headers['user-agent'],
      videoId: v.id,
      title: t.subtitle ? `${t.title} — ${t.subtitle}` : t.title,
      mode: spec.mode,
      quality: spec.mode === 'transcode' ? spec.quality : 'original',
      bytes: 0,
    });
    const text = await ctx.hls.variantPlaylist(hlsSource(v), spec, ownerOf(request));
    reply.header('Content-Type', M3U8).header('Cache-Control', 'no-cache');
    return reply.send(text);
  });

  app.get('/api/hls/:videoId/:variant/:file', async (request, reply) => {
    const { videoId, variant, file } = parse(variantParams.extend({ file: z.string().max(32) }), request.params);
    const spec = parseVariantId(variant);
    if (!spec || !isSegmentName(file)) throw new AppError(400, 'BAD_REQUEST', 'Invalid segment');
    const v = await loadVideo(videoId);
    const t = titleOf(v);
    const ip = request.ip;
    const ua = request.headers['user-agent'];
    const streamKey = StreamTracker.key(ip, ua, v.id);
    if (!ctx.tracker.isActive(streamKey) && ctx.tracker.activeCount(streamKey) >= ctx.settings.get().maxStreams) {
      throw new AppError(503, 'STREAM_LIMIT', 'The server is busy: maximum number of simultaneous streams reached');
    }
    const segPath = await ctx.hls.segment(hlsSource(v), spec, file, ownerOf(request));
    const st = await stat(segPath);
    ctx.tracker.record({
      ip,
      ua,
      videoId: v.id,
      title: t.subtitle ? `${t.title} — ${t.subtitle}` : t.title,
      mode: spec.mode,
      quality: spec.mode === 'transcode' ? spec.quality : 'original',
      bytes: st.size,
    });
    const type = file.endsWith('.ts') ? 'video/mp2t' : file.endsWith('.m4s') ? 'video/iso.segment' : 'video/mp4';
    reply.header('Content-Type', type).header('Content-Length', String(st.size)).header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(segPath));
  });

  /* ------------------------------ Subtitles ------------------------------ */
  app.get('/api/subtitles/:videoId', async (request) => {
    const { videoId } = parse(videoIdParamsSchema, request.params);
    const v = await loadVideo(videoId, { allowMissing: true });
    return ok(ctx.catalog.videoInfo(v).subtitles);
  });

  app.get('/api/subtitles/:videoId/:file', async (request, reply) => {
    const { videoId, file } = parse(z.object({ videoId: idSchema, file: z.string().regex(/^[a-zA-Z0-9_-]{1,64}\.vtt$/) }), request.params);
    const subId = file.slice(0, -4);
    const v = await loadVideo(videoId, { allowMissing: true });
    const sub = await ctx.db.subtitle.findFirst({ where: { id: subId, videoFileId: v.id } });
    if (!sub) throw notFound('Subtitle');
    const vtt = await ctx.subtitles.toVtt(sub, { path: v.path, folderPath: v.folder.path });
    reply.header('Content-Type', 'text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=600');
    return reply.send(vtt);
  });

  /* ------------------------------ Images ------------------------------ */
  app.get('/api/images/:name', async (request, reply) => {
    const { name } = parse(z.object({ name: z.string().max(160) }), request.params);
    const file = ctx.images.resolve(name);
    if (!file) throw notFound('Image');
    const type = name.endsWith('.webp') ? 'image/webp' : name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    // Image names change whenever artwork changes, so they can be cached forever.
    reply.header('Content-Type', type).header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(file));
  });
}
