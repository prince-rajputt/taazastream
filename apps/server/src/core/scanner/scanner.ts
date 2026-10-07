import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { opendir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MediaFolder, Prisma, VideoFile } from '@prisma/client';
import { accentFor, slugify, type ScanJobInfo } from '@taazastream/shared';
import type { Logger } from 'pino';
import type { Db } from '../database';
import type { FfmpegTools } from '../ffmpeg';
import type { LocalImageServer } from '../images';
import { parseProbe, type MediaProbe } from '../probe';
import type { SearchService } from '../search';
import type { LocalSettings } from '../settings';
import {
  IMAGE_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  languageLabel,
  parseMediaPath,
  parseSubtitleSidecar,
  sortTitleOf,
  type ParsedEpisode,
  type ParsedMovie,
} from './filename';
import { readSidecarMetadata, type SidecarMetadata } from './sidecar';

const SKIP_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  '@eadir',
  '#recycle',
  '.trash',
  '.trashes',
  'node_modules',
  '.taazastream',
  'extras',
  'featurettes',
  'behind the scenes',
  'trailers',
]);

interface FoundFile {
  path: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

interface ScanCounters {
  filesSeen: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  filesFailed: number;
}

export interface ScanOptions {
  folderId?: string;
  full?: boolean;
}

/** Walk a directory tree yielding video files. Symlinked directories are not followed. */
export async function* walkVideos(root: string, rel = ''): AsyncGenerator<FoundFile> {
  let dir;
  try {
    dir = await opendir(path.join(root, rel));
  } catch {
    return;
  }
  for await (const entry of dir) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    const relPath = rel ? path.join(rel, name) : name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name.toLowerCase())) continue;
      yield* walkVideos(root, relPath);
    } else if (entry.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      const full = path.join(root, relPath);
      try {
        const st = await stat(full);
        // Skip "sample" clips that ship with releases.
        if (
          /(^|[\s._-])sample([\s._-]|$)/i.test(path.basename(name, ext)) &&
          st.size < 150 * 1024 * 1024
        )
          continue;
        if (st.size === 0) continue;
        yield { path: full, relPath, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
      } catch {
        // unreadable entry: ignore
      }
    }
  }
}

async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  shouldStop: () => boolean,
) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length && !shouldStop()) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * LocalMediaScanner — indexes admin-approved folders into SQLite.
 * Detects new, changed, moved and deleted files; never copies or modifies media.
 */
export class LocalMediaScanner extends EventEmitter {
  private current: ScanJobInfo | null = null;
  private cancelRequested = false;
  private queue: ScanOptions[] = [];
  private touchedMovies = new Set<string>();
  private touchedSeries = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly ffmpeg: FfmpegTools,
    private readonly images: LocalImageServer,
    private readonly search: SearchService,
    private readonly settings: LocalSettings,
    private readonly log: Logger,
  ) {
    super();
  }

  get status(): ScanJobInfo | null {
    return this.current;
  }

  get isRunning(): boolean {
    return this.current?.status === 'running';
  }

  cancel(): boolean {
    if (!this.isRunning) return false;
    this.cancelRequested = true;
    this.queue = [];
    return true;
  }

  /** Queue a scan. Returns the job (running, or queued behind the current one). */
  async start(options: ScanOptions = {}): Promise<ScanJobInfo> {
    const job = await this.db.scanJob.create({
      data: { folderId: options.folderId ?? null, full: options.full ?? false, status: 'queued' },
    });
    const info = this.toInfo(job, 0, null);
    if (this.isRunning) {
      this.queue.push({ ...options, jobId: job.id } as ScanOptions & { jobId: string });
      return info;
    }
    void this.run(job.id, options);
    return { ...info, status: 'running' };
  }

  /** Run a scan to completion (used by tests and the CLI). */
  async scanNow(options: ScanOptions = {}): Promise<ScanJobInfo> {
    const job = await this.db.scanJob.create({
      data: { folderId: options.folderId ?? null, full: options.full ?? false, status: 'queued' },
    });
    return this.run(job.id, options);
  }

  private toInfo(
    job: {
      id: string;
      status: string;
      folderId: string | null;
      startedAt: Date | null;
      finishedAt: Date | null;
      message: string | null;
    },
    progress: number,
    currentFile: string | null,
    counters?: ScanCounters,
  ): ScanJobInfo {
    return {
      id: job.id,
      status: job.status as ScanJobInfo['status'],
      folderId: job.folderId,
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      filesSeen: counters?.filesSeen ?? 0,
      filesAdded: counters?.filesAdded ?? 0,
      filesUpdated: counters?.filesUpdated ?? 0,
      filesRemoved: counters?.filesRemoved ?? 0,
      filesFailed: counters?.filesFailed ?? 0,
      currentFile,
      message: job.message,
      progress,
    };
  }

  private async run(jobId: string, options: ScanOptions): Promise<ScanJobInfo> {
    this.cancelRequested = false;
    this.touchedMovies.clear();
    this.touchedSeries.clear();
    const startedAt = new Date();
    const counters: ScanCounters = {
      filesSeen: 0,
      filesAdded: 0,
      filesUpdated: 0,
      filesRemoved: 0,
      filesFailed: 0,
    };
    let job = await this.db.scanJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt },
    });
    this.current = this.toInfo(job, 0, null, counters);
    this.emit('progress', this.current);
    this.log.info(
      { jobId, folderId: options.folderId ?? 'all', full: !!options.full },
      'library scan started',
    );

    let lastPersist = 0;
    const report = (progress: number, currentFile: string | null) => {
      this.current = this.toInfo(job, progress, currentFile, counters);
      this.emit('progress', this.current);
      const now = Date.now();
      if (now - lastPersist > 2000) {
        lastPersist = now;
        void this.db.scanJob
          .update({ where: { id: jobId }, data: { ...counters } })
          .catch(() => undefined);
      }
    };

    let status: 'completed' | 'failed' | 'cancelled' = 'completed';
    let message: string | null = null;
    try {
      const folders = await this.db.mediaFolder.findMany({
        where: options.folderId ? { id: options.folderId } : { enabled: true },
      });
      if (folders.length === 0) message = 'No media folders configured';
      for (const folder of folders) {
        if (this.cancelRequested) break;
        await this.scanFolder(folder, !!options.full, counters, report);
      }
      await this.cleanupOrphans();
      for (const id of this.touchedMovies) await this.search.indexMovie(id);
      for (const id of this.touchedSeries) await this.search.indexSeries(id);
      if (this.cancelRequested) {
        status = 'cancelled';
        message = 'Scan cancelled';
      }
    } catch (err) {
      status = 'failed';
      message = (err as Error).message;
      this.log.error({ err: message, jobId }, 'library scan failed');
    }

    job = await this.db.scanJob.update({
      where: { id: jobId },
      data: { ...counters, status, message, finishedAt: new Date() },
    });
    this.current = this.toInfo(job, 1, null, counters);
    this.emit('progress', this.current);
    this.emit('finished', this.current);
    this.log.info(
      { jobId, status, ms: Date.now() - startedAt.getTime(), ...counters },
      'library scan finished',
    );

    const result = this.current;
    const next = this.queue.shift() as (ScanOptions & { jobId?: string }) | undefined;
    if (next?.jobId) void this.run(next.jobId, next);
    return result;
  }

  private async scanFolder(
    folder: MediaFolder,
    full: boolean,
    counters: ScanCounters,
    report: (progress: number, file: string | null) => void,
  ) {
    const kind = (folder.kind as 'movies' | 'series' | 'mixed') ?? 'mixed';
    const existing = await this.db.videoFile.findMany({ where: { folderId: folder.id } });
    const byPath = new Map(existing.map((v) => [v.path, v]));

    if (!existsSync(folder.path)) {
      // Drive unplugged or folder renamed: keep records, but mark them unavailable.
      const res = await this.db.videoFile.updateMany({
        where: { folderId: folder.id, missing: false },
        data: { missing: true },
      });
      counters.filesRemoved += res.count;
      this.log.warn(
        { folder: folder.path },
        'media folder not reachable; its videos are marked missing',
      );
      return;
    }

    const found: FoundFile[] = [];
    for await (const f of walkVideos(folder.path)) {
      found.push(f);
      counters.filesSeen++;
      if (found.length % 200 === 0) report(0, f.relPath);
      if (this.cancelRequested) return;
    }
    const foundPaths = new Set(found.map((f) => f.path));

    // Moved/renamed files: same name+size reappearing elsewhere keeps its id (and watch progress).
    const vanished = existing.filter((v) => !foundPaths.has(v.path));
    const newFiles = found.filter((f) => !byPath.has(f.path));
    for (const f of newFiles) {
      const idx = vanished.findIndex(
        (v) =>
          Number(v.sizeBytes) === f.size &&
          v.fileName.toLowerCase() === path.basename(f.path).toLowerCase(),
      );
      if (idx >= 0) {
        const moved = vanished.splice(idx, 1)[0]!;
        const updated = await this.db.videoFile.update({
          where: { id: moved.id },
          data: { path: f.path, relPath: f.relPath, missing: false },
        });
        byPath.set(f.path, updated);
        this.log.info({ from: moved.relPath, to: f.relPath }, 'video moved');
      }
    }

    let processed = 0;
    await pool(
      found,
      3,
      async (f) => {
        const prev = byPath.get(f.path);
        try {
          const unchanged =
            prev &&
            Number(prev.sizeBytes) === f.size &&
            prev.mtimeMs === f.mtimeMs &&
            prev.probedAt &&
            !prev.probeError;
          if (unchanged && !full) {
            if (prev.missing) {
              await this.db.videoFile.update({ where: { id: prev.id }, data: { missing: false } });
              counters.filesUpdated++;
            }
          } else {
            const ok = await this.processFile(folder, kind, f, prev);
            if (!ok) counters.filesFailed++;
            else if (prev) counters.filesUpdated++;
            else counters.filesAdded++;
          }
        } catch (err) {
          counters.filesFailed++;
          this.log.warn({ file: f.relPath, err: (err as Error).message }, 'failed to index file');
        }
        processed++;
        report(found.length ? processed / found.length : 1, f.relPath);
      },
      () => this.cancelRequested,
    );

    if (this.cancelRequested) return;
    const goneIds = vanished.filter((v) => !v.missing).map((v) => v.id);
    if (goneIds.length) {
      await this.db.videoFile.updateMany({
        where: { id: { in: goneIds } },
        data: { missing: true },
      });
      counters.filesRemoved += goneIds.length;
      this.log.info({ folder: folder.path, count: goneIds.length }, 'deleted files detected');
    }
    await this.db.mediaFolder.update({
      where: { id: folder.id },
      data: { lastScannedAt: new Date() },
    });
  }

  private async probe(
    filePath: string,
  ): Promise<{ probe: MediaProbe | null; error: string | null }> {
    if (!this.ffmpeg.ffprobe.available) return { probe: null, error: null };
    try {
      return { probe: parseProbe(await this.ffmpeg.probeJson(filePath)), error: null };
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      return {
        probe: null,
        error: (e.stderr || e.message).toString().split('\n')[0]!.slice(0, 300),
      };
    }
  }

  /** Probe one file, upsert its VideoFile and link it to a movie or an episode. */
  private async processFile(
    folder: MediaFolder,
    kind: 'movies' | 'series' | 'mixed',
    f: FoundFile,
    prev: VideoFile | undefined,
  ): Promise<boolean> {
    const { probe, error } = await this.probe(f.path);
    const ext = path.extname(f.path).slice(1).toLowerCase();
    const corrupted = !!error || (probe != null && !probe.videoCodec);

    const data: Prisma.VideoFileUncheckedCreateInput = {
      folderId: folder.id,
      path: f.path,
      relPath: f.relPath,
      fileName: path.basename(f.path),
      sizeBytes: BigInt(f.size),
      mtimeMs: f.mtimeMs,
      container: containerFamily(probe?.container ?? null, ext),
      durationSec: probe?.durationSec ?? 0,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      videoCodec: probe?.videoCodec ?? null,
      videoProfile: probe?.videoProfile ?? null,
      pixFmt: probe?.pixFmt ?? null,
      bitDepth: probe?.bitDepth ?? null,
      audioCodec: probe?.audio.find((a) => a.isDefault)?.codec ?? probe?.audio[0]?.codec ?? null,
      bitrate: probe?.bitrate ?? null,
      fps: probe?.fps ?? null,
      missing: false,
      probeError: corrupted ? (error ?? 'No video stream found') : null,
      probedAt: new Date(),
    };

    const video = prev
      ? await this.db.videoFile.update({ where: { id: prev.id }, data })
      : await this.db.videoFile.create({ data });

    if (corrupted) {
      this.log.warn({ file: f.relPath, err: data.probeError }, 'corrupted or unsupported video');
      return false;
    }

    if (probe) {
      await this.db.audioTrack.deleteMany({ where: { videoFileId: video.id } });
      if (probe.audio.length) {
        await this.db.audioTrack.createMany({
          data: probe.audio.map((a) => ({
            videoFileId: video.id,
            index: a.index,
            streamIndex: a.streamIndex,
            codec: a.codec,
            language: a.language,
            title: a.title,
            channels: a.channels,
            isDefault: a.isDefault,
          })),
        });
      }
    }
    await this.syncSubtitles(video.id, f.path, probe);

    const parsed = parseMediaPath(f.path, kind);
    if (parsed.kind === 'movie') await this.linkMovie(video, parsed, f.path, probe);
    else await this.linkEpisode(video, parsed, f.path, probe);
    return true;
  }

  private async syncSubtitles(videoId: string, videoPath: string, probe: MediaProbe | null) {
    await this.db.subtitle.deleteMany({
      where: { videoFileId: videoId, source: { in: ['embedded', 'sidecar'] } },
    });
    const rows: Prisma.SubtitleCreateManyInput[] = [];
    for (const s of probe?.subtitles ?? []) {
      const lang = languageLabel(s.language);
      rows.push({
        videoFileId: videoId,
        source: 'embedded',
        streamIndex: s.streamIndex,
        format: s.codec,
        language: s.language,
        label: [s.title ?? lang ?? `Track ${s.streamIndex}`, s.forced ? '(Forced)' : '']
          .filter(Boolean)
          .join(' '),
        isDefault: s.isDefault,
        forced: s.forced,
      });
    }
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(ext)) continue;
      const info = parseSubtitleSidecar(base, name);
      if (!info) continue;
      const lang = languageLabel(info.language);
      rows.push({
        videoFileId: videoId,
        source: 'sidecar',
        path: path.join(dir, name),
        format: ext.slice(1),
        language: info.language,
        label: [lang ?? 'External', info.forced ? '(Forced)' : ''].filter(Boolean).join(' '),
        isDefault: info.isDefault,
        forced: info.forced,
      });
    }
    if (rows.length) await this.db.subtitle.createMany({ data: rows });
  }

  private async findArtwork(dir: string, names: string[]): Promise<string | null> {
    for (const n of names) {
      for (const ext of IMAGE_EXTENSIONS) {
        const candidate = path.join(dir, `${n}${ext}`);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  private async connectGenres(names: string[] | undefined) {
    if (!names?.length) return undefined;
    const connect: { id: string }[] = [];
    for (const raw of names.slice(0, 20)) {
      const name = raw.trim();
      const slug = slugify(name);
      if (!name || !slug) continue;
      const genre = await this.db.genre.upsert({
        where: { slug },
        create: { name, slug },
        update: {},
      });
      connect.push({ id: genre.id });
    }
    return connect;
  }

  private metaFields(meta: SidecarMetadata) {
    const out: Record<string, unknown> = {};
    if (meta.originalTitle) out.originalTitle = meta.originalTitle;
    if (meta.overview) out.overview = meta.overview;
    if (meta.tagline) out.tagline = meta.tagline;
    if (meta.director) out.director = meta.director;
    if (meta.rating != null) out.rating = meta.rating;
    if (meta.contentRating) out.contentRating = meta.contentRating;
    if (meta.cast?.length) out.cast = JSON.stringify(meta.cast);
    return out;
  }

  private async linkMovie(
    video: VideoFile,
    parsed: ParsedMovie,
    filePath: string,
    probe: MediaProbe | null,
  ) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const meta = await readSidecarMetadata([
      path.join(dir, `${base}.nfo`),
      path.join(dir, `${base}.json`),
      path.join(dir, 'movie.nfo'),
      path.join(dir, 'movie.json'),
    ]);
    const title = meta.title ?? parsed.title;
    const year = meta.year ?? parsed.year;
    const sortTitle = sortTitleOf(title);

    let movie =
      (video.movieId ? await this.db.movie.findUnique({ where: { id: video.movieId } }) : null) ??
      (await this.db.movie.findFirst({
        where: { sortTitle, ...(year ? { OR: [{ year }, { year: null }] } : {}) },
        orderBy: { addedAt: 'asc' },
      }));

    const genres = await this.connectGenres(meta.genres);
    if (!movie) {
      movie = await this.db.movie.create({
        data: {
          title,
          sortTitle,
          year,
          accent: accentFor(sortTitle),
          ...this.metaFields(meta),
          ...(genres ? { genres: { connect: genres } } : {}),
        },
      });
    } else if (!movie.metadataLocked) {
      movie = await this.db.movie.update({
        where: { id: movie.id },
        data: {
          title,
          sortTitle,
          year: year ?? movie.year,
          ...this.metaFields(meta),
          ...(genres ? { genres: { set: [], connect: genres } } : {}),
        },
      });
    }

    await this.db.videoFile.update({
      where: { id: video.id },
      data: { movieId: movie.id, episodeId: null },
    });
    this.touchedMovies.add(movie.id);

    // Artwork: sidecar files first, generated frames as a fallback.
    const thumbs = this.settings.get().thumbnailsEnabled;
    const update: Prisma.MovieUpdateInput = {};
    if (!movie.posterImage) {
      const src = await this.findArtwork(dir, [
        `${base}-poster`,
        `${base}.poster`,
        'poster',
        'folder',
        'cover',
      ]);
      if (src) update.posterImage = await this.images.fromFile(src, 'poster', movie.id);
    }
    if (!movie.backdropImage) {
      const src = await this.findArtwork(dir, [
        `${base}-fanart`,
        `${base}-backdrop`,
        'fanart',
        'backdrop',
        'background',
      ]);
      if (src) update.backdropImage = await this.images.fromFile(src, 'backdrop', movie.id);
      else if (thumbs)
        update.backdropImage = await this.images.fromVideo(
          filePath,
          frameTime(probe, 0.22),
          'backdrop',
          movie.id,
        );
    }
    if (Object.keys(update).length)
      await this.db.movie.update({ where: { id: movie.id }, data: update });
    if (thumbs && !video.thumbImage) {
      const thumb = await this.images.fromVideo(
        filePath,
        frameTime(probe, 0.12),
        'thumb',
        video.id,
      );
      if (thumb)
        await this.db.videoFile.update({ where: { id: video.id }, data: { thumbImage: thumb } });
    }
  }

  private async linkEpisode(
    video: VideoFile,
    parsed: ParsedEpisode,
    filePath: string,
    probe: MediaProbe | null,
  ) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const seasonDir = /^(?:season|series|staffel|saison|temporada|s)[\s._-]*\d{1,3}$/i.test(
      path.basename(dir),
    );
    const seriesDir = seasonDir ? path.dirname(dir) : dir;

    const seriesMeta = await readSidecarMetadata([
      path.join(seriesDir, 'tvshow.nfo'),
      path.join(seriesDir, 'series.json'),
      path.join(seriesDir, 'tvshow.json'),
    ]);
    const epMeta = await readSidecarMetadata([
      path.join(dir, `${base}.nfo`),
      path.join(dir, `${base}.json`),
    ]);

    const seriesTitle = seriesMeta.title ?? parsed.seriesTitle;
    const sortTitle = sortTitleOf(seriesTitle);
    const genres = await this.connectGenres(seriesMeta.genres);

    let series = await this.db.series.findUnique({ where: { sortTitle } });
    if (!series) {
      series = await this.db.series.create({
        data: {
          title: seriesTitle,
          sortTitle,
          year: seriesMeta.year ?? parsed.year,
          accent: accentFor(sortTitle),
          overview: seriesMeta.overview ?? null,
          rating: seriesMeta.rating ?? null,
          contentRating: seriesMeta.contentRating ?? null,
          cast: seriesMeta.cast ? JSON.stringify(seriesMeta.cast) : '[]',
          ...(genres ? { genres: { connect: genres } } : {}),
        },
      });
    } else if (!series.metadataLocked && Object.keys(seriesMeta).length) {
      series = await this.db.series.update({
        where: { id: series.id },
        data: {
          title: seriesTitle,
          year: seriesMeta.year ?? series.year,
          overview: seriesMeta.overview ?? series.overview,
          rating: seriesMeta.rating ?? series.rating,
          contentRating: seriesMeta.contentRating ?? series.contentRating,
          ...(seriesMeta.cast ? { cast: JSON.stringify(seriesMeta.cast) } : {}),
          ...(genres ? { genres: { set: [], connect: genres } } : {}),
        },
      });
    }

    const season = await this.db.season.upsert({
      where: { seriesId_number: { seriesId: series.id, number: parsed.seasonNumber } },
      create: {
        seriesId: series.id,
        number: parsed.seasonNumber,
        title: parsed.seasonNumber === 0 ? 'Specials' : `Season ${parsed.seasonNumber}`,
      },
      update: {},
    });

    const epTitle = epMeta.title ?? parsed.episodeTitle ?? `Episode ${parsed.episodeNumber}`;
    const existingEp = await this.db.episode.findUnique({
      where: { seasonId_number: { seasonId: season.id, number: parsed.episodeNumber } },
    });
    const episode = existingEp
      ? existingEp.metadataLocked
        ? existingEp
        : await this.db.episode.update({
            where: { id: existingEp.id },
            data: { title: epTitle, overview: epMeta.overview ?? existingEp.overview },
          })
      : await this.db.episode.create({
          data: {
            seriesId: series.id,
            seasonId: season.id,
            number: parsed.episodeNumber,
            title: epTitle,
            overview: epMeta.overview ?? null,
          },
        });

    await this.db.videoFile.update({
      where: { id: video.id },
      data: { episodeId: episode.id, movieId: null },
    });
    this.touchedSeries.add(series.id);

    const thumbs = this.settings.get().thumbnailsEnabled;
    if (thumbs && !episode.thumbImage) {
      const sidecarThumb = await this.findArtwork(dir, [`${base}-thumb`, base]);
      const thumb = sidecarThumb
        ? await this.images.fromFile(sidecarThumb, 'thumb', episode.id)
        : await this.images.fromVideo(filePath, frameTime(probe, 0.25), 'thumb', episode.id);
      if (thumb) {
        await this.db.episode.update({ where: { id: episode.id }, data: { thumbImage: thumb } });
        await this.db.videoFile.update({ where: { id: video.id }, data: { thumbImage: thumb } });
      }
    }

    const update: Prisma.SeriesUpdateInput = {};
    if (!series.posterImage) {
      const src = await this.findArtwork(seriesDir, ['poster', 'folder', 'cover']);
      if (src) update.posterImage = await this.images.fromFile(src, 'poster', series.id);
    }
    if (!series.backdropImage) {
      const src = await this.findArtwork(seriesDir, ['fanart', 'backdrop', 'background']);
      if (src) update.backdropImage = await this.images.fromFile(src, 'backdrop', series.id);
      else if (thumbs)
        update.backdropImage = await this.images.fromVideo(
          filePath,
          frameTime(probe, 0.3),
          'backdrop',
          series.id,
        );
    }
    if (!season.posterImage) {
      const n = String(parsed.seasonNumber).padStart(2, '0');
      const src = await this.findArtwork(seriesDir, [
        `season${n}-poster`,
        `season${parsed.seasonNumber}-poster`,
        `season${n}`,
      ]);
      if (src) {
        const img = await this.images.fromFile(src, 'season', season.id);
        if (img)
          await this.db.season.update({ where: { id: season.id }, data: { posterImage: img } });
      }
    }
    if (Object.keys(update).length)
      await this.db.series.update({ where: { id: series.id }, data: update });
  }

  /** Remove titles that no longer have any video file (e.g. after files were relinked). */
  async cleanupOrphans(): Promise<void> {
    const movies = await this.db.movie.findMany({
      where: { videos: { none: {} } },
      select: { id: true, posterImage: true, backdropImage: true },
    });
    for (const m of movies) {
      await this.db.movie.delete({ where: { id: m.id } });
      await this.search.remove('movie', m.id);
      await this.images.remove(m.posterImage);
      await this.images.remove(m.backdropImage);
    }
    const episodes = await this.db.episode.findMany({
      where: { videos: { none: {} } },
      select: { id: true, thumbImage: true },
    });
    for (const e of episodes) {
      await this.db.episode.delete({ where: { id: e.id } });
      await this.images.remove(e.thumbImage);
    }
    await this.db.season.deleteMany({ where: { episodes: { none: {} } } });
    const series = await this.db.series.findMany({
      where: { episodes: { none: {} } },
      select: { id: true, posterImage: true, backdropImage: true },
    });
    for (const s of series) {
      await this.db.series.delete({ where: { id: s.id } });
      await this.search.remove('series', s.id);
      await this.images.remove(s.posterImage);
      await this.images.remove(s.backdropImage);
    }
    await this.db.genre.deleteMany({ where: { movies: { none: {} }, series: { none: {} } } });
  }
}

/**
 * ffprobe names Matroska and WebM identically ("matroska,webm"). Store the browser-relevant
 * family instead, using the extension to tell the two apart.
 */
export function containerFamily(probeName: string | null, ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  const n = (probeName ?? '').toLowerCase();
  if (n.includes('matroska') || n.includes('webm')) return e === 'webm' ? 'webm' : 'mkv';
  if (n.includes('mp4') || n.includes('mov')) return e === 'mov' ? 'mov' : 'mp4';
  return n.split(',')[0] || e;
}

function frameTime(probe: MediaProbe | null, fraction: number): number {
  const d = probe?.durationSec ?? 0;
  if (d <= 0) return 5;
  return Math.min(d * fraction, Math.max(d - 1, 0));
}
