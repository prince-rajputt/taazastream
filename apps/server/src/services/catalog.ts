import type { Prisma } from '@prisma/client';
import {
  MIN_RESUME_SECONDS,
  slugify,
  type CastMember,
  type ContinueWatchingItem,
  type EpisodeInfo,
  type GenreInfo,
  type HomeFeed,
  type HomeRow,
  type MovieDetail,
  type ProgressInfo,
  type SeriesDetail,
  type SubtitleInfo,
  type TitleCard,
  type VideoInfo,
} from '@taazastream/shared';
import { LocalImageServer } from '../core/images';
import type { Db } from '../core/database';
import { isTextSubtitle } from '../core/subtitles';
import { notFound } from '../http/errors';

const img = LocalImageServer.urlFor;

/** Only titles with at least one healthy, present file are shown to viewers. */
export const playableVideo: Prisma.VideoFileWhereInput = { missing: false, probeError: null };
export const playableMovie: Prisma.MovieWhereInput = { videos: { some: playableVideo } };
export const playableSeries: Prisma.SeriesWhereInput = {
  episodes: { some: { videos: { some: playableVideo } } },
};

const movieCardInclude = {
  genres: { select: { name: true } },
  videos: {
    where: playableVideo,
    select: { id: true, durationSec: true, height: true },
    orderBy: [{ height: 'desc' }, { sizeBytes: 'desc' }],
    take: 1,
  },
} satisfies Prisma.MovieInclude;

const seriesCardInclude = {
  genres: { select: { name: true } },
  _count: { select: { seasons: true, episodes: true } },
} satisfies Prisma.SeriesInclude;

type MovieCardRow = Prisma.MovieGetPayload<{ include: typeof movieCardInclude }>;
type SeriesCardRow = Prisma.SeriesGetPayload<{ include: typeof seriesCardInclude }>;

export function parseCast(json: string): CastMember[] {
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c) => (typeof c === 'string' ? { name: c } : (c as CastMember)))
      .filter((c) => c && typeof c.name === 'string')
      .slice(0, 50);
  } catch {
    return [];
  }
}

function progressOf(
  row:
    { videoFileId: string; positionSec: number; durationSec: number; updatedAt: Date } | undefined,
): ProgressInfo | null {
  if (!row || row.durationSec <= 0) return null;
  return {
    videoId: row.videoFileId,
    positionSec: row.positionSec,
    durationSec: row.durationSec,
    percent: Math.min(1, row.positionSec / row.durationSec),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class CatalogService {
  constructor(private readonly db: Db) {}

  movieCard(m: MovieCardRow): TitleCard {
    const v = m.videos[0];
    return {
      id: m.id,
      kind: 'movie',
      title: m.title,
      year: m.year,
      overview: m.overview,
      genres: m.genres.map((g) => g.name),
      rating: m.rating,
      contentRating: m.contentRating,
      durationSec: v?.durationSec ? Math.round(v.durationSec) : null,
      posterUrl: img(m.posterImage),
      backdropUrl: img(m.backdropImage),
      accent: m.accent,
      addedAt: m.addedAt.toISOString(),
      videoId: v?.id ?? null,
    };
  }

  seriesCard(s: SeriesCardRow): TitleCard {
    return {
      id: s.id,
      kind: 'series',
      title: s.title,
      year: s.year,
      overview: s.overview,
      genres: s.genres.map((g) => g.name),
      rating: s.rating,
      contentRating: s.contentRating,
      durationSec: null,
      posterUrl: img(s.posterImage),
      backdropUrl: img(s.backdropImage),
      accent: s.accent,
      addedAt: s.addedAt.toISOString(),
      seasonCount: s._count.seasons,
      episodeCount: s._count.episodes,
    };
  }

  async movies(args: Prisma.MovieFindManyArgs = {}): Promise<TitleCard[]> {
    const rows = await this.db.movie.findMany({
      ...args,
      where: { AND: [playableMovie, args.where ?? {}] },
      include: movieCardInclude,
    });
    return rows.map((m) => this.movieCard(m));
  }

  async series(args: Prisma.SeriesFindManyArgs = {}): Promise<TitleCard[]> {
    const rows = await this.db.series.findMany({
      ...args,
      where: { AND: [playableSeries, args.where ?? {}] },
      include: seriesCardInclude,
    });
    return rows.map((s) => this.seriesCard(s));
  }

  /** Decorate cards with this profile's progress and My List state. */
  async decorate(cards: TitleCard[], userId: string): Promise<TitleCard[]> {
    if (!cards.length) return cards;
    const movieIds = cards.filter((c) => c.kind === 'movie').map((c) => c.id);
    const seriesIds = cards.filter((c) => c.kind === 'series').map((c) => c.id);
    const [favs, progress] = await Promise.all([
      this.db.favorite.findMany({
        where: { userId, OR: [{ movieId: { in: movieIds } }, { seriesId: { in: seriesIds } }] },
        select: { movieId: true, seriesId: true },
      }),
      this.db.continueWatching.findMany({
        where: {
          userId,
          OR: [{ movieId: { in: movieIds } }, { seriesId: { in: seriesIds } }],
          hidden: false,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    const favSet = new Set(favs.map((f) => f.movieId ?? f.seriesId));
    return cards.map((c) => {
      const p = progress.find((x) =>
        c.kind === 'movie' ? x.movieId === c.id : x.seriesId === c.id,
      );
      return {
        ...c,
        inMyList: favSet.has(c.id),
        progress: p && !p.completed && p.positionSec >= MIN_RESUME_SECONDS ? progressOf(p) : null,
      };
    });
  }

  async genres(): Promise<GenreInfo[]> {
    const rows = await this.db.genre.findMany({
      include: {
        _count: { select: { movies: { where: playableMovie }, series: { where: playableSeries } } },
      },
      orderBy: { name: 'asc' },
    });
    return rows
      .map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        count: g._count.movies + g._count.series,
      }))
      .filter((g) => g.count > 0);
  }

  private subtitleInfo(
    videoId: string,
    s: {
      id: string;
      language: string | null;
      label: string;
      format: string;
      source: string;
      isDefault: boolean;
      forced: boolean;
    },
  ): SubtitleInfo {
    return {
      id: s.id,
      language: s.language,
      label: s.label,
      format: s.format,
      source: s.source as SubtitleInfo['source'],
      isDefault: s.isDefault,
      forced: s.forced,
      url: isTextSubtitle(s.format) ? `/api/subtitles/${videoId}/${s.id}.vtt` : null,
    };
  }

  videoInfo(
    v: Prisma.VideoFileGetPayload<{ include: { audioTracks: true; subtitles: true } }>,
  ): VideoInfo {
    return {
      id: v.id,
      fileName: v.fileName,
      container: v.container,
      durationSec: v.durationSec,
      sizeBytes: Number(v.sizeBytes),
      width: v.width,
      height: v.height,
      videoCodec: v.videoCodec,
      audioCodec: v.audioCodec,
      bitrate: v.bitrate,
      fps: v.fps,
      bitDepth: v.bitDepth,
      audioTracks: v.audioTracks
        .sort((a, b) => a.index - b.index)
        .map((a) => ({
          index: a.index,
          codec: a.codec,
          language: a.language,
          title: a.title,
          channels: a.channels,
          isDefault: a.isDefault,
        })),
      subtitles: v.subtitles.map((s) => this.subtitleInfo(v.id, s)),
      available: !v.missing && !v.probeError,
    };
  }

  async movieDetail(id: string, userId: string): Promise<MovieDetail> {
    const m = await this.db.movie.findUnique({
      where: { id },
      include: {
        genres: { select: { name: true } },
        videos: {
          include: { audioTracks: true, subtitles: true },
          orderBy: [{ missing: 'asc' }, { height: 'desc' }],
        },
      },
    });
    if (!m) throw notFound('Movie');
    const playable = m.videos.filter((v) => !v.missing && !v.probeError);
    const card = this.movieCard({
      ...m,
      videos: playable
        .slice(0, 1)
        .map((v) => ({ id: v.id, durationSec: v.durationSec, height: v.height })),
    });
    const [decorated] = await this.decorate([card], userId);
    const genreNames = m.genres.map((g) => g.name);
    const related = await this.related('movie', m.id, genreNames, userId);
    return {
      ...decorated!,
      kind: 'movie',
      tagline: m.tagline,
      cast: parseCast(m.cast),
      director: m.director,
      videos: m.videos.map((v) => this.videoInfo(v)),
      related,
    };
  }

  async related(
    kind: 'movie' | 'series',
    excludeId: string,
    genres: string[],
    userId: string,
  ): Promise<TitleCard[]> {
    const byGenre = genres.length ? { genres: { some: { name: { in: genres } } } } : {};
    const [movies, series] = await Promise.all([
      this.movies({
        where: { ...byGenre, id: kind === 'movie' ? { not: excludeId } : undefined },
        take: 12,
        orderBy: { playCount: 'desc' },
      }),
      this.series({
        where: { ...byGenre, id: kind === 'series' ? { not: excludeId } : undefined },
        take: 6,
        orderBy: { playCount: 'desc' },
      }),
    ]);
    let items = [...movies, ...series];
    if (items.length < 6) {
      const fill = await this.movies({
        where: { id: { notIn: [excludeId, ...items.map((i) => i.id)] } },
        take: 12 - items.length,
        orderBy: { addedAt: 'desc' },
      });
      items = [...items, ...fill];
    }
    return this.decorate(items.slice(0, 12), userId);
  }

  async seriesDetail(id: string, userId: string): Promise<SeriesDetail> {
    const s = await this.db.series.findUnique({
      where: { id },
      include: {
        ...seriesCardInclude,
        seasons: {
          orderBy: { number: 'asc' },
          include: {
            episodes: {
              orderBy: { number: 'asc' },
              include: {
                videos: {
                  where: playableVideo,
                  select: { id: true, durationSec: true, thumbImage: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!s) throw notFound('Series');
    const progress = await this.db.continueWatching.findMany({ where: { userId, seriesId: id } });
    const progressByEpisode = new Map(progress.map((p) => [p.episodeId, p]));

    const seasons = s.seasons
      .map((season) => ({
        id: season.id,
        seriesId: s.id,
        number: season.number,
        title: season.title ?? `Season ${season.number}`,
        overview: season.overview,
        posterUrl: img(season.posterImage),
        episodes: season.episodes
          .filter((e) => e.videos.length > 0)
          .map((e): EpisodeInfo => {
            const v = e.videos[0]!;
            const p = progressByEpisode.get(e.id);
            return {
              id: e.id,
              seriesId: s.id,
              seasonId: season.id,
              seasonNumber: season.number,
              episodeNumber: e.number,
              title: e.title,
              overview: e.overview,
              durationSec: v.durationSec ? Math.round(v.durationSec) : null,
              thumbUrl: img(e.thumbImage ?? v.thumbImage),
              videoId: v.id,
              airDate: e.airDate?.toISOString() ?? null,
              progress: p
                ? { ...progressOf(p)!, percent: p.completed ? 1 : progressOf(p)!.percent }
                : null,
            };
          }),
      }))
      .filter((season) => season.episodes.length > 0);

    const flat = seasons.flatMap((x) => x.episodes);
    const latest = [...progress].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    let nextUp: EpisodeInfo | null = flat[0] ?? null;
    if (latest) {
      const idx = flat.findIndex((e) => e.id === latest.episodeId);
      if (idx >= 0) nextUp = latest.completed ? (flat[idx + 1] ?? flat[idx]!) : flat[idx]!;
    }

    const [card] = await this.decorate([this.seriesCard(s)], userId);
    const related = await this.related(
      'series',
      s.id,
      s.genres.map((g) => g.name),
      userId,
    );
    return { ...card!, kind: 'series', cast: parseCast(s.cast), seasons, related, nextUp };
  }

  /** Continue Watching: newest first, one entry per series (its current/next episode). */
  async continueWatching(userId: string, limit = 20): Promise<ContinueWatchingItem[]> {
    const rows = await this.db.continueWatching.findMany({
      where: { userId, hidden: false, videoFile: playableVideo },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        movie: {
          select: { id: true, title: true, backdropImage: true, posterImage: true, accent: true },
        },
        series: {
          select: { id: true, title: true, backdropImage: true, posterImage: true, accent: true },
        },
        episode: {
          select: {
            id: true,
            number: true,
            title: true,
            thumbImage: true,
            seasonId: true,
            season: { select: { number: true } },
          },
        },
        videoFile: { select: { thumbImage: true } },
      },
    });
    const out: ContinueWatchingItem[] = [];
    const seenSeries = new Set<string>();
    for (const r of rows) {
      if (out.length >= limit) break;
      if (r.series) {
        if (seenSeries.has(r.series.id)) continue;
        seenSeries.add(r.series.id);
        let ep = r.episode;
        let videoId = r.videoFileId;
        let position = r.positionSec;
        let duration = r.durationSec;
        let thumb = r.episode?.thumbImage ?? r.videoFile.thumbImage;
        if (r.completed) {
          const next = await this.nextEpisode(r.episodeId);
          if (!next) continue; // finished the series
          ep = next.episode;
          videoId = next.videoId;
          position = 0;
          duration = next.durationSec;
          thumb = next.episode.thumbImage;
        } else if (r.positionSec < MIN_RESUME_SECONDS) continue;
        out.push({
          videoId,
          kind: 'series',
          titleId: r.series.id,
          episodeId: ep?.id ?? null,
          title: r.series.title,
          subtitle: ep ? `S${ep.season.number} E${ep.number} · ${ep.title}` : null,
          positionSec: position,
          durationSec: duration,
          percent: duration > 0 ? Math.min(1, position / duration) : 0,
          backdropUrl: img(thumb ?? r.series.backdropImage),
          posterUrl: img(r.series.posterImage),
          accent: r.series.accent,
          updatedAt: r.updatedAt.toISOString(),
        });
      } else if (r.movie) {
        if (r.completed || r.positionSec < MIN_RESUME_SECONDS) continue;
        out.push({
          videoId: r.videoFileId,
          kind: 'movie',
          titleId: r.movie.id,
          episodeId: null,
          title: r.movie.title,
          subtitle: null,
          positionSec: r.positionSec,
          durationSec: r.durationSec,
          percent: r.durationSec > 0 ? Math.min(1, r.positionSec / r.durationSec) : 0,
          backdropUrl: img(r.movie.backdropImage ?? r.videoFile.thumbImage),
          posterUrl: img(r.movie.posterImage),
          accent: r.movie.accent,
          updatedAt: r.updatedAt.toISOString(),
        });
      }
    }
    return out;
  }

  /** The episode after `episodeId` (crossing season boundaries) with a playable file. */
  async nextEpisode(episodeId: string | null) {
    if (!episodeId) return null;
    const ep = await this.db.episode.findUnique({
      where: { id: episodeId },
      include: { season: true },
    });
    if (!ep) return null;
    const candidates = await this.db.episode.findMany({
      where: {
        seriesId: ep.seriesId,
        videos: { some: playableVideo },
        OR: [
          { season: { number: ep.season.number }, number: { gt: ep.number } },
          { season: { number: { gt: ep.season.number } } },
        ],
      },
      include: {
        season: { select: { number: true } },
        videos: { where: playableVideo, select: { id: true, durationSec: true }, take: 1 },
      },
    });
    candidates.sort((a, b) => a.season.number - b.season.number || a.number - b.number);
    const next = candidates[0];
    if (!next?.videos[0]) return null;
    return { episode: next, videoId: next.videos[0].id, durationSec: next.videos[0].durationSec };
  }

  async myList(userId: string): Promise<TitleCard[]> {
    const favs = await this.db.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const movieIds = favs.map((f) => f.movieId).filter((x): x is string => !!x);
    const seriesIds = favs.map((f) => f.seriesId).filter((x): x is string => !!x);
    const [movies, series] = await Promise.all([
      this.movies({ where: { id: { in: movieIds } } }),
      this.series({ where: { id: { in: seriesIds } } }),
    ]);
    const order = new Map(favs.map((f, i) => [f.movieId ?? f.seriesId, i]));
    const cards = [...movies, ...series].sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    return this.decorate(cards, userId);
  }

  async home(userId: string): Promise<HomeFeed> {
    const since = new Date(Date.now() - 21 * 24 * 3600_000);
    const [
      continueItems,
      recentMovies,
      recentSeries,
      popularMovies,
      popularSeries,
      newReleases,
      featured,
      myList,
      genres,
      trendingRows,
    ] = await Promise.all([
      this.continueWatching(userId),
      this.movies({ orderBy: { addedAt: 'desc' }, take: 24 }),
      this.series({ orderBy: { addedAt: 'desc' }, take: 24 }),
      this.movies({ orderBy: [{ playCount: 'desc' }, { rating: 'desc' }], take: 24 }),
      this.series({ orderBy: [{ playCount: 'desc' }, { rating: 'desc' }], take: 24 }),
      this.movies({
        where: { year: { not: null } },
        orderBy: [{ year: 'desc' }, { addedAt: 'desc' }],
        take: 24,
      }),
      this.movies({ where: { featured: true }, take: 6 }),
      this.myList(userId),
      this.genres(),
      this.db.watchHistory.groupBy({
        by: ['videoFileId'],
        where: { startedAt: { gte: since } },
        _count: { videoFileId: true },
        orderBy: { _count: { videoFileId: 'desc' } },
        take: 60,
      }),
    ]);

    const libraryEmpty = recentMovies.length === 0 && recentSeries.length === 0;

    // Trending: most started in the last three weeks (movies + series), else recent popular.
    const trendingVideos = await this.db.videoFile.findMany({
      where: { id: { in: trendingRows.map((r) => r.videoFileId) } },
      select: { id: true, movieId: true, episode: { select: { seriesId: true } } },
    });
    const score = new Map<string, number>();
    for (const r of trendingRows) {
      const v = trendingVideos.find((x) => x.id === r.videoFileId);
      const key = v?.movieId ? `m:${v.movieId}` : v?.episode ? `s:${v.episode.seriesId}` : null;
      if (key) score.set(key, (score.get(key) ?? 0) + r._count.videoFileId);
    }
    const trendingIds = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const trendingMovies = await this.movies({
      where: { id: { in: trendingIds.filter((k) => k.startsWith('m:')).map((k) => k.slice(2)) } },
    });
    const trendingSeries = await this.series({
      where: { id: { in: trendingIds.filter((k) => k.startsWith('s:')).map((k) => k.slice(2)) } },
    });
    let trending = [...trendingMovies, ...trendingSeries].sort(
      (a, b) =>
        trendingIds.indexOf(`${a.kind === 'movie' ? 'm' : 's'}:${a.id}`) -
        trendingIds.indexOf(`${b.kind === 'movie' ? 'm' : 's'}:${b.id}`),
    );
    if (trending.length < 5) {
      const fill = interleave(popularMovies, popularSeries).filter(
        (c) => !trending.some((t) => t.id === c.id),
      );
      trending = [...trending, ...fill].slice(0, 10);
    }

    const recent = [...recentMovies, ...recentSeries]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .slice(0, 24);
    const heroPool = (featured.length ? featured : interleave(recentMovies, recentSeries))
      .filter((c) => c.backdropUrl)
      .slice(0, 6);
    const hero = await this.decorate(heroPool.length ? heroPool : recent.slice(0, 1), userId);

    const rows: HomeRow[] = [];
    const push = async (row: Omit<HomeRow, 'items'> & { items: TitleCard[] }) => {
      if (row.items.length || row.continueItems?.length)
        rows.push({ ...row, items: await this.decorate(row.items, userId) });
    };
    if (continueItems.length)
      rows.push({
        id: 'continue',
        title: 'Continue Watching',
        variant: 'continue',
        items: [],
        continueItems,
      });
    await push({
      id: 'trending',
      title: 'Trending Now',
      variant: 'ranked',
      items: trending.slice(0, 10),
    });
    await push({ id: 'recent', title: 'Recently Added', variant: 'landscape', items: recent });
    await push({
      id: 'my-list',
      title: 'My List',
      variant: 'poster',
      items: myList,
      href: '/my-list',
    });
    await push({
      id: 'movies',
      title: 'Movies',
      variant: 'poster',
      items: recentMovies,
      href: '/movies',
    });
    await push({
      id: 'series',
      title: 'Series',
      variant: 'poster',
      items: recentSeries,
      href: '/series',
    });
    await push({
      id: 'popular',
      title: 'Popular on TaazaStream',
      variant: 'poster',
      items: interleave(popularMovies, popularSeries).slice(0, 24),
    });
    await push({
      id: 'new-releases',
      title: 'New Releases',
      variant: 'landscape',
      items: newReleases,
    });

    for (const g of [...genres].sort((a, b) => b.count - a.count).slice(0, 6)) {
      const [gm, gs] = await Promise.all([
        this.movies({
          where: { genres: { some: { id: g.id } } },
          take: 20,
          orderBy: { addedAt: 'desc' },
        }),
        this.series({
          where: { genres: { some: { id: g.id } } },
          take: 10,
          orderBy: { addedAt: 'desc' },
        }),
      ]);
      await push({
        id: `genre-${g.slug}`,
        title: g.name,
        variant: 'poster',
        items: interleave(gm, gs),
        href: `/genre/${g.slug}`,
      });
    }

    return { hero, rows, genres, libraryEmpty };
  }

  async genreBySlug(slug: string) {
    const g = await this.db.genre.findUnique({ where: { slug: slugify(slug) } });
    if (!g) throw notFound('Genre');
    return g;
  }
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]!);
    if (b[i]) out.push(b[i]!);
  }
  return out;
}
