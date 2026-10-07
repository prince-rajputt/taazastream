import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import {
  accentFor,
  episodePatchSchema,
  idParamsSchema,
  idSchema,
  mediaFolderPatchSchema,
  mediaFolderSchema,
  moviePatchSchema,
  scanRequestSchema,
  seriesPatchSchema,
  settingsPatchSchema,
  slugify,
  type AdminLibraryItem,
  type AdminStats,
  type AdminVideoFile,
  type MediaFolderInfo,
  type ScanStatus,
} from '@taazastream/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { ImageRole } from '../core/images';
import { LocalImageServer } from '../core/images';
import { isForbiddenMediaRoot } from '../core/paths';
import { sortTitleOf } from '../core/scanner/filename';
import { diskUsage } from '../core/system';
import { AppError, badRequest, conflict, notFound, ok } from '../http/errors';
import { parse } from '../http/validate';

const img = LocalImageServer.urlFor;

async function readUpload(
  request: FastifyRequest,
): Promise<{ data: Buffer; filename: string; fields: Record<string, string> }> {
  if (!request.isMultipart()) throw badRequest('Expected a multipart/form-data upload');
  const file = await request.file();
  if (!file) throw badRequest('No file uploaded');
  const data = await file.toBuffer();
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(file.fields)) {
    const field = Array.isArray(v) ? v[0] : v;
    if (field && 'value' in field && typeof field.value === 'string')
      fields[k] = field.value.slice(0, 200);
  }
  return { data, filename: file.filename, fields };
}

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  /* ------------------------------ Dashboard ------------------------------ */
  app.get('/api/admin/stats', async () => {
    const [
      movies,
      series,
      seasons,
      episodes,
      videos,
      missingVideos,
      folders,
      size,
      lastScan,
      cacheBytes,
    ] = await Promise.all([
      db.movie.count(),
      db.series.count(),
      db.season.count(),
      db.episode.count(),
      db.videoFile.count({ where: { missing: false } }),
      db.videoFile.count({ where: { missing: true } }),
      db.mediaFolder.findMany(),
      db.videoFile.aggregate({ _sum: { sizeBytes: true }, where: { missing: false } }),
      db.scanJob.findFirst({ orderBy: { createdAt: 'desc' } }),
      ctx.hls.cacheSize(),
    ]);
    const disks = await diskUsage([
      ...folders.filter((f) => existsSync(f.path)).map((f) => ({ path: f.path, label: f.label })),
      { path: ctx.config.dataDir, label: 'TaazaStream data' },
    ]);
    const mem = process.memoryUsage();
    const settings = ctx.settings.get();
    const stats: AdminStats = {
      counts: {
        movies,
        series,
        seasons,
        episodes,
        videos,
        missingVideos,
        mediaFolders: folders.length,
      },
      storage: { libraryBytes: Number(size._sum.sizeBytes ?? 0n), disks, cacheBytes },
      system: {
        cpuPercent: ctx.cpu.percent,
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model?.trim() ?? 'CPU',
        loadAvg: os.loadavg(),
        memTotalBytes: os.totalmem(),
        memUsedBytes: os.totalmem() - os.freemem(),
        processRssBytes: mem.rss,
        processHeapBytes: mem.heapUsed,
      },
      network: ctx.tracker.network(),
      streams: {
        active: ctx.tracker.activeCount(),
        max: settings.maxStreams,
        transcodes: ctx.hls.transcodeCount,
        maxTranscodes: settings.maxTranscodes,
      },
      devices: { connected: ctx.tracker.connectedCount() },
      lastScan:
        ctx.scanner.status ??
        (lastScan
          ? {
              id: lastScan.id,
              status: lastScan.status as ScanStatus,
              folderId: lastScan.folderId,
              startedAt: lastScan.startedAt?.toISOString() ?? null,
              finishedAt: lastScan.finishedAt?.toISOString() ?? null,
              filesSeen: lastScan.filesSeen,
              filesAdded: lastScan.filesAdded,
              filesUpdated: lastScan.filesUpdated,
              filesRemoved: lastScan.filesRemoved,
              filesFailed: lastScan.filesFailed,
              currentFile: null,
              message: lastScan.message,
              progress: 1,
            }
          : null),
      server: ctx.serverInfo(),
    };
    return ok(stats);
  });

  app.get('/api/admin/devices', async () => ok(ctx.tracker.listDevices()));
  app.get('/api/admin/streams', async () => ok(ctx.tracker.listStreams()));

  app.get('/api/admin/server', async () => {
    const info = ctx.serverInfo();
    const qrSvg = await QRCode.toString(info.primaryUrl, {
      type: 'svg',
      margin: 1,
      color: { dark: '#0b0b10', light: '#ffffff' },
    });
    return ok({ ...info, qrSvg });
  });

  /* ------------------------------ Media folders ------------------------------ */
  const folderInfo = async (f: {
    id: string;
    path: string;
    label: string;
    kind: string;
    enabled: boolean;
    lastScannedAt: Date | null;
    createdAt: Date;
  }): Promise<MediaFolderInfo> => ({
    id: f.id,
    path: f.path,
    label: f.label,
    kind: f.kind as MediaFolderInfo['kind'],
    enabled: f.enabled,
    exists: existsSync(f.path),
    videoCount: await db.videoFile.count({ where: { folderId: f.id, missing: false } }),
    lastScannedAt: f.lastScannedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  });

  app.get('/api/admin/media-folders', async () => {
    const folders = await db.mediaFolder.findMany({ orderBy: { createdAt: 'asc' } });
    return ok(await Promise.all(folders.map(folderInfo)));
  });

  app.post('/api/admin/media-folders', async (request) => {
    const body = parse(mediaFolderSchema, request.body);
    const resolved = path.resolve(body.path);
    if (!path.isAbsolute(body.path))
      throw badRequest('Use an absolute path, e.g. D:\\TaazaStream\\Movies');
    if (isForbiddenMediaRoot(resolved))
      throw badRequest('This system folder cannot be used as a media folder');
    let st;
    try {
      st = await stat(resolved);
    } catch {
      throw badRequest('Folder not found on the server');
    }
    if (!st.isDirectory()) throw badRequest('Path is not a folder');
    const all = await db.mediaFolder.findMany();
    const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
    for (const f of all) {
      const a = norm(path.resolve(f.path));
      const b = norm(resolved);
      if (a === b) throw conflict('This folder is already in the library');
      if (b.startsWith(a + path.sep) || a.startsWith(b + path.sep))
        throw conflict(`Overlaps with existing folder ${f.path}`);
    }
    const folder = await db.mediaFolder.create({
      data: {
        path: resolved,
        label: body.label || path.basename(resolved) || resolved,
        kind: body.kind,
      },
    });
    ctx.log.info({ path: resolved, kind: body.kind }, 'media folder added');
    return ok(await folderInfo(folder));
  });

  app.patch('/api/admin/media-folders/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(mediaFolderPatchSchema, request.body);
    const folder = await db.mediaFolder.update({ where: { id }, data: body });
    return ok(await folderInfo(folder));
  });

  /** Removes the folder and its index entries. Files on disk are never touched. */
  app.delete('/api/admin/media-folders/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    if (ctx.scanner.isRunning) throw conflict('Wait for the current scan to finish');
    const folder = await db.mediaFolder.findUnique({ where: { id } });
    if (!folder) throw notFound('Media folder');
    await db.mediaFolder.delete({ where: { id } });
    await ctx.scanner.cleanupOrphans();
    await ctx.search.rebuild();
    ctx.log.info({ path: folder.path }, 'media folder removed (files untouched)');
    return ok({ deleted: true });
  });

  /** Directory picker for "Add media folder" (admin only, names of folders only). */
  app.get('/api/admin/fs/browse', async (request) => {
    const q = parse(z.object({ path: z.string().max(1024).optional() }), request.query);
    if (!q.path) {
      if (process.platform === 'win32') {
        const drives: { name: string; path: string }[] = [];
        for (let c = 65; c <= 90; c++) {
          const drive = `${String.fromCharCode(c)}:\\`;
          if (existsSync(drive)) drives.push({ name: drive, path: drive });
        }
        return ok({ path: null, parent: null, entries: drives });
      }
      return ok({
        path: '/',
        parent: null,
        entries: [
          { name: '/', path: '/' },
          { name: os.homedir(), path: os.homedir() },
        ],
      });
    }
    const dir = path.resolve(q.path);
    let names: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      names = entries
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith('.') &&
            !e.name.startsWith('$') &&
            e.name !== 'System Volume Information',
        )
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      throw badRequest('Folder cannot be read');
    }
    const parent = path.dirname(dir);
    return ok({
      path: dir,
      parent: parent === dir ? null : parent,
      entries: names.slice(0, 500).map((name) => ({ name, path: path.join(dir, name) })),
    });
  });

  /* ------------------------------ Scanning ------------------------------ */
  app.post('/api/admin/scan', async (request) => {
    const body = parse(scanRequestSchema, request.body ?? {});
    if (body.folderId && !(await db.mediaFolder.findUnique({ where: { id: body.folderId } })))
      throw notFound('Media folder');
    if (!(await db.mediaFolder.count())) throw badRequest('Add a media folder first');
    return ok(await ctx.scanner.start(body));
  });

  app.get('/api/admin/scan', async () => {
    const recent = await db.scanJob.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    return ok({
      current: ctx.scanner.status,
      recent: recent.map((j) => ({
        id: j.id,
        status: j.status,
        folderId: j.folderId,
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        filesSeen: j.filesSeen,
        filesAdded: j.filesAdded,
        filesUpdated: j.filesUpdated,
        filesRemoved: j.filesRemoved,
        filesFailed: j.filesFailed,
        currentFile: null,
        message: j.message,
        progress: 1,
      })),
    });
  });

  app.post('/api/admin/scan/cancel', async () => ok({ cancelled: ctx.scanner.cancel() }));

  /* ------------------------------ Library ------------------------------ */
  app.get('/api/admin/library', async (request) => {
    const q = parse(
      z.object({
        kind: z.enum(['all', 'movie', 'series']).default('all'),
        q: z.string().max(100).optional(),
        missing: z.enum(['0', '1']).optional(),
      }),
      request.query,
    );
    const titleFilter = q.q ? { title: { contains: q.q } } : {};
    const items: AdminLibraryItem[] = [];
    if (q.kind !== 'series') {
      const movies = await db.movie.findMany({
        where: {
          ...titleFilter,
          ...(q.missing === '1' ? { videos: { some: { missing: true } } } : {}),
        },
        include: { genres: true, videos: { select: { missing: true, relPath: true } } },
        orderBy: { addedAt: 'desc' },
        take: 1000,
      });
      for (const m of movies) {
        items.push({
          id: m.id,
          kind: 'movie',
          title: m.title,
          year: m.year,
          posterUrl: img(m.posterImage),
          backdropUrl: img(m.backdropImage),
          accent: m.accent,
          genres: m.genres.map((g) => g.name),
          videoCount: m.videos.length,
          missing: m.videos.length > 0 && m.videos.every((v) => v.missing),
          addedAt: m.addedAt.toISOString(),
          path: m.videos[0]?.relPath ?? null,
        });
      }
    }
    if (q.kind !== 'movie') {
      const series = await db.series.findMany({
        where: titleFilter,
        include: {
          genres: true,
          _count: { select: { episodes: true } },
          episodes: { select: { videos: { select: { missing: true } } } },
        },
        orderBy: { addedAt: 'desc' },
        take: 500,
      });
      for (const s of series) {
        const vids = s.episodes.flatMap((e) => e.videos);
        const missing = vids.length > 0 && vids.every((v) => v.missing);
        if (q.missing === '1' && !vids.some((v) => v.missing)) continue;
        items.push({
          id: s.id,
          kind: 'series',
          title: s.title,
          year: s.year,
          posterUrl: img(s.posterImage),
          backdropUrl: img(s.backdropImage),
          accent: s.accent,
          genres: s.genres.map((g) => g.name),
          videoCount: vids.length,
          episodeCount: s._count.episodes,
          missing,
          addedAt: s.addedAt.toISOString(),
          path: null,
        });
      }
    }
    items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return ok(items);
  });

  const adminVideo = (
    v: Prisma.VideoFileGetPayload<{ include: { audioTracks: true; subtitles: true } }>,
  ): AdminVideoFile => {
    const info = ctx.catalog.videoInfo(v);
    return {
      id: v.id,
      path: v.path,
      sizeBytes: Number(v.sizeBytes),
      durationSec: v.durationSec,
      width: v.width,
      height: v.height,
      videoCodec: v.videoCodec,
      audioCodec: v.audioCodec,
      container: v.container,
      missing: v.missing,
      subtitles: info.subtitles,
      audioTracks: info.audioTracks,
    };
  };

  app.get('/api/admin/movies/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const m = await db.movie.findUnique({
      where: { id },
      include: { genres: true, videos: { include: { audioTracks: true, subtitles: true } } },
    });
    if (!m) throw notFound('Movie');
    return ok({
      id: m.id,
      kind: 'movie' as const,
      title: m.title,
      year: m.year,
      overview: m.overview,
      tagline: m.tagline,
      genres: m.genres.map((g) => g.name),
      cast: JSON.parse(m.cast) as unknown,
      director: m.director,
      rating: m.rating,
      contentRating: m.contentRating,
      featured: m.featured,
      metadataLocked: m.metadataLocked,
      posterUrl: img(m.posterImage),
      backdropUrl: img(m.backdropImage),
      accent: m.accent,
      videos: m.videos.map(adminVideo),
    });
  });

  const genreConnect = async (names: string[]) => {
    const out: { id: string }[] = [];
    for (const raw of names) {
      const name = raw.trim();
      const slug = slugify(name);
      if (!slug) continue;
      const g = await db.genre.upsert({ where: { slug }, create: { name, slug }, update: {} });
      out.push({ id: g.id });
    }
    return out;
  };

  app.patch('/api/admin/movies/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(moviePatchSchema, request.body);
    const { genres, cast, ...rest } = body;
    const data: Prisma.MovieUpdateInput = { ...rest, metadataLocked: true };
    if (rest.title) {
      data.sortTitle = sortTitleOf(rest.title);
      data.accent = accentFor(data.sortTitle);
    }
    if (cast) data.cast = JSON.stringify(cast);
    if (genres) data.genres = { set: [], connect: await genreConnect(genres) };
    await db.movie.update({ where: { id }, data });
    await ctx.search.indexMovie(id);
    await db.genre.deleteMany({ where: { movies: { none: {} }, series: { none: {} } } });
    ctx.log.info({ movieId: id }, 'movie metadata edited');
    return ok({ updated: true });
  });

  app.delete('/api/admin/movies/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const m = await db.movie.findUnique({
      where: { id },
      include: { videos: { select: { thumbImage: true } } },
    });
    if (!m) throw notFound('Movie');
    await db.videoFile.deleteMany({ where: { movieId: id } });
    await db.movie.delete({ where: { id } });
    await ctx.search.remove('movie', id);
    for (const name of [m.posterImage, m.backdropImage, ...m.videos.map((v) => v.thumbImage)])
      await ctx.images.remove(name);
    ctx.log.info({ movieId: id, title: m.title }, 'movie removed from database (files untouched)');
    return ok({ deleted: true });
  });

  app.get('/api/admin/series/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const s = await db.series.findUnique({
      where: { id },
      include: {
        genres: true,
        seasons: {
          orderBy: { number: 'asc' },
          include: {
            episodes: {
              orderBy: { number: 'asc' },
              include: { videos: { include: { audioTracks: true, subtitles: true } } },
            },
          },
        },
      },
    });
    if (!s) throw notFound('Series');
    return ok({
      id: s.id,
      kind: 'series' as const,
      title: s.title,
      year: s.year,
      overview: s.overview,
      genres: s.genres.map((g) => g.name),
      cast: JSON.parse(s.cast) as unknown,
      rating: s.rating,
      contentRating: s.contentRating,
      featured: s.featured,
      metadataLocked: s.metadataLocked,
      posterUrl: img(s.posterImage),
      backdropUrl: img(s.backdropImage),
      accent: s.accent,
      seasons: s.seasons.map((season) => ({
        id: season.id,
        number: season.number,
        title: season.title,
        episodes: season.episodes.map((e) => ({
          id: e.id,
          number: e.number,
          title: e.title,
          overview: e.overview,
          thumbUrl: img(e.thumbImage),
          videos: e.videos.map(adminVideo),
        })),
      })),
    });
  });

  app.patch('/api/admin/series/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(seriesPatchSchema, request.body);
    const { genres, cast, ...rest } = body;
    const data: Prisma.SeriesUpdateInput = { ...rest, metadataLocked: true };
    if (rest.title) {
      const sortTitle = sortTitleOf(rest.title);
      const clash = await db.series.findFirst({ where: { sortTitle, id: { not: id } } });
      if (clash) throw conflict('Another series already uses this title');
      data.sortTitle = sortTitle;
    }
    if (cast) data.cast = JSON.stringify(cast);
    if (genres) data.genres = { set: [], connect: await genreConnect(genres) };
    await db.series.update({ where: { id }, data });
    await ctx.search.indexSeries(id);
    ctx.log.info({ seriesId: id }, 'series metadata edited');
    return ok({ updated: true });
  });

  app.delete('/api/admin/series/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const s = await db.series.findUnique({
      where: { id },
      include: { episodes: { select: { id: true, thumbImage: true } } },
    });
    if (!s) throw notFound('Series');
    await db.videoFile.deleteMany({ where: { episodeId: { in: s.episodes.map((e) => e.id) } } });
    await db.series.delete({ where: { id } });
    await ctx.search.remove('series', id);
    for (const name of [s.posterImage, s.backdropImage, ...s.episodes.map((e) => e.thumbImage)])
      await ctx.images.remove(name);
    ctx.log.info(
      { seriesId: id, title: s.title },
      'series removed from database (files untouched)',
    );
    return ok({ deleted: true });
  });

  app.patch('/api/admin/episodes/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(episodePatchSchema, request.body);
    const ep = await db.episode.findUnique({ where: { id } });
    if (!ep) throw notFound('Episode');
    const data: Prisma.EpisodeUncheckedUpdateInput = { metadataLocked: true };
    if (body.title !== undefined) data.title = body.title;
    if (body.overview !== undefined) data.overview = body.overview;
    if (body.episodeNumber !== undefined) data.number = body.episodeNumber;
    if (body.seasonNumber !== undefined) {
      const season = await db.season.upsert({
        where: { seriesId_number: { seriesId: ep.seriesId, number: body.seasonNumber } },
        create: {
          seriesId: ep.seriesId,
          number: body.seasonNumber,
          title: `Season ${body.seasonNumber}`,
        },
        update: {},
      });
      data.seasonId = season.id;
    }
    await db.episode.update({ where: { id }, data });
    await db.season.deleteMany({ where: { seriesId: ep.seriesId, episodes: { none: {} } } });
    await ctx.search.indexSeries(ep.seriesId);
    return ok({ updated: true });
  });

  /** Remove a single video's database entry (the file stays on disk; a rescan re-adds it). */
  app.delete('/api/admin/videos/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const v = await db.videoFile.findUnique({ where: { id } });
    if (!v) throw notFound('Video');
    await db.videoFile.delete({ where: { id } });
    await ctx.images.remove(v.thumbImage);
    await ctx.scanner.cleanupOrphans();
    return ok({ deleted: true });
  });

  app.post('/api/admin/library/remove-missing', async () => {
    const res = await db.videoFile.deleteMany({ where: { missing: true } });
    await ctx.scanner.cleanupOrphans();
    await ctx.search.rebuild();
    return ok({ removed: res.count });
  });

  /* ------------------------------ Artwork ------------------------------ */
  const artworkParams = z.object({
    kind: z.enum(['movies', 'series']),
    id: idSchema,
    role: z.enum(['poster', 'backdrop']),
  });

  const setArtwork = async (
    kind: 'movies' | 'series',
    id: string,
    role: 'poster' | 'backdrop',
    name: string,
  ) => {
    const field = role === 'poster' ? 'posterImage' : 'backdropImage';
    if (kind === 'movies') {
      const m = await db.movie.findUnique({ where: { id } });
      if (!m) throw notFound('Movie');
      await db.movie.update({ where: { id }, data: { [field]: name } });
      await ctx.images.remove(m[field]);
    } else {
      const s = await db.series.findUnique({ where: { id } });
      if (!s) throw notFound('Series');
      await db.series.update({ where: { id }, data: { [field]: name } });
      await ctx.images.remove(s[field]);
    }
  };

  app.post('/api/admin/:kind/:id/artwork/:role', async (request) => {
    const params = parse(artworkParams, request.params);
    const upload = await readUpload(request);
    let name: string;
    try {
      name = await ctx.images.fromUpload(upload.data, params.role as ImageRole, params.id);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    await setArtwork(params.kind, params.id, params.role, name);
    return ok({ url: img(name) });
  });

  /** Regenerate artwork from a frame of the video at a given time. */
  app.post('/api/admin/:kind/:id/artwork/:role/from-video', async (request) => {
    const params = parse(artworkParams, request.params);
    const body = parse(z.object({ atSec: z.number().min(0).max(86_400) }), request.body);
    const video =
      params.kind === 'movies'
        ? await db.videoFile.findFirst({ where: { movieId: params.id, missing: false } })
        : await db.videoFile.findFirst({
            where: { episode: { seriesId: params.id }, missing: false },
          });
    if (!video) throw notFound('Playable video');
    const at = Math.min(body.atSec, Math.max(0, video.durationSec - 1));
    const name = await ctx.images.fromVideo(
      video.path,
      at,
      params.role === 'poster' ? 'poster' : 'backdrop',
      params.id,
    );
    if (!name)
      throw new AppError(
        500,
        'TRANSCODE_FAILED',
        'Could not extract a frame (is FFmpeg installed?)',
      );
    await setArtwork(params.kind, params.id, params.role, name);
    return ok({ url: img(name) });
  });

  /* ------------------------------ Subtitles ------------------------------ */
  app.post('/api/admin/videos/:id/subtitles', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const video = await db.videoFile.findUnique({ where: { id } });
    if (!video) throw notFound('Video');
    const upload = await readUpload(request);
    const ext = path.extname(upload.filename).toLowerCase();
    if (ext !== '.srt' && ext !== '.vtt') throw badRequest('Upload an .srt or .vtt file');
    const language = /^[a-z]{2,3}$/.test(upload.fields.language ?? '')
      ? upload.fields.language!
      : null;
    const label =
      (upload.fields.label ?? '').trim() || (language ? language.toUpperCase() : 'Uploaded');
    const sub = await db.subtitle.create({
      data: {
        videoFileId: id,
        source: 'uploaded',
        format: 'vtt',
        language,
        label,
        path: 'pending',
      },
    });
    try {
      const name = await ctx.subtitles.saveUpload(
        sub.id,
        upload.data,
        ext === '.srt' ? 'srt' : 'vtt',
      );
      await db.subtitle.update({ where: { id: sub.id }, data: { path: name } });
    } catch (err) {
      await db.subtitle.delete({ where: { id: sub.id } });
      throw err;
    }
    return ok({ id: sub.id });
  });

  app.delete('/api/admin/subtitles/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const sub = await db.subtitle.findUnique({ where: { id } });
    if (!sub) throw notFound('Subtitle');
    if (sub.source !== 'uploaded')
      throw badRequest(
        'Only uploaded subtitles can be deleted. Remove sidecar files from disk and rescan.',
      );
    await db.subtitle.delete({ where: { id } });
    await ctx.subtitles.removeUpload(sub.path);
    return ok({ deleted: true });
  });

  /* ------------------------------ Settings ------------------------------ */
  app.get('/api/admin/settings', async () => ok(ctx.settings.get()));

  app.patch('/api/admin/settings', async (request) => {
    const body = parse(settingsPatchSchema, request.body);
    for (const key of ['ffmpegPath', 'ffprobePath'] as const) {
      const p = body[key];
      if (p && (!path.isAbsolute(p) || !existsSync(p)))
        throw badRequest(`${key}: file not found on the server`);
    }
    const next = await ctx.settings.update(body);
    ctx.log.info({ keys: Object.keys(body) }, 'settings updated');
    return ok(next);
  });

  /* ------------------------------ Cache / search ------------------------------ */
  app.get('/api/admin/cache', async () =>
    ok({ hlsBytes: await ctx.hls.cacheSize(), activeJobs: ctx.hls.jobCount }),
  );
  app.post('/api/admin/cache/clear', async () => {
    await ctx.hls.clearCache();
    return ok({ cleared: true });
  });
  app.post('/api/admin/search/rebuild', async () => {
    await ctx.search.rebuild();
    return ok({ rebuilt: true });
  });

  /* ------------------------------ Backups ------------------------------ */
  app.get('/api/admin/backups', async () => ok(await ctx.backup.list()));
  app.post('/api/admin/backups', async () => ok(await ctx.backup.create()));
  app.get('/api/admin/backups/:file', async (request, reply) => {
    const { file } = parse(z.object({ file: z.string().max(64) }), request.params);
    const full = ctx.backup.resolve(file);
    if (!full) throw notFound('Backup');
    reply.header('Content-Disposition', `attachment; filename="${file}"`);
    reply.header(
      'Content-Type',
      file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    );
    return reply.send(createReadStream(full));
  });
  app.delete('/api/admin/backups/:file', async (request) => {
    const { file } = parse(z.object({ file: z.string().max(64) }), request.params);
    if (!(await ctx.backup.remove(file))) throw notFound('Backup');
    return ok({ deleted: true });
  });

  /* ------------------------------ Cloud (optional) ------------------------------ */
  app.get('/api/admin/cloud', async () => ok(ctx.cloud.status));
  app.post('/api/admin/cloud/check', async () => ok(await ctx.cloud.check()));
  app.post('/api/admin/cloud/sync', async () => ok(await ctx.cloud.sync()));
}
