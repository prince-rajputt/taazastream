import type { Prisma } from '@prisma/client';
import {
  idParamsSchema,
  idSchema,
  listQuerySchema,
  myListSchema,
  searchQuerySchema,
  slugify,
  suggestQuerySchema,
  watchProgressSchema,
  type Paged,
  type SearchResult,
  type SearchSuggestion,
  type TitleCard,
} from '@taazastream/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { LocalImageServer } from '../core/images';
import { notFound, ok } from '../http/errors';
import { parse } from '../http/validate';
import { playableMovie, playableSeries } from '../services/catalog';

type Sort = z.infer<typeof listQuerySchema>['sort'];

function movieOrder(sort: Sort): Prisma.MovieOrderByWithRelationInput[] {
  switch (sort) {
    case 'title':
      return [{ sortTitle: 'asc' }];
    case 'year':
      return [{ year: 'desc' }, { sortTitle: 'asc' }];
    case 'rating':
      return [{ rating: 'desc' }, { sortTitle: 'asc' }];
    case 'popular':
      return [{ playCount: 'desc' }, { addedAt: 'desc' }];
    default:
      return [{ addedAt: 'desc' }];
  }
}

function seriesOrder(sort: Sort): Prisma.SeriesOrderByWithRelationInput[] {
  switch (sort) {
    case 'title':
      return [{ sortTitle: 'asc' }];
    case 'year':
      return [{ year: 'desc' }, { sortTitle: 'asc' }];
    case 'rating':
      return [{ rating: 'desc' }, { sortTitle: 'asc' }];
    case 'popular':
      return [{ playCount: 'desc' }, { addedAt: 'desc' }];
    default:
      return [{ addedAt: 'desc' }];
  }
}

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext) {
  const { catalog, db } = ctx;

  app.get('/api/home', async (request) => ok(await catalog.home(request.profileId)));

  app.get('/api/movies', async (request) => {
    const q = parse(listQuerySchema, request.query);
    const where: Prisma.MovieWhereInput = {
      ...(q.genre ? { genres: { some: { slug: slugify(q.genre) } } } : {}),
      ...(q.year ? { year: q.year } : {}),
    };
    const [total, items] = await Promise.all([
      db.movie.count({ where: { AND: [playableMovie, where] } }),
      catalog.movies({ where, orderBy: movieOrder(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const result: Paged<TitleCard> = { items: await catalog.decorate(items, request.profileId), total, page: q.page, pageSize: q.pageSize };
    return ok(result);
  });

  app.get('/api/movies/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return ok(await catalog.movieDetail(id, request.profileId));
  });

  app.get('/api/series', async (request) => {
    const q = parse(listQuerySchema, request.query);
    const where: Prisma.SeriesWhereInput = {
      ...(q.genre ? { genres: { some: { slug: slugify(q.genre) } } } : {}),
      ...(q.year ? { year: q.year } : {}),
    };
    const [total, items] = await Promise.all([
      db.series.count({ where: { AND: [playableSeries, where] } }),
      catalog.series({ where, orderBy: seriesOrder(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const result: Paged<TitleCard> = { items: await catalog.decorate(items, request.profileId), total, page: q.page, pageSize: q.pageSize };
    return ok(result);
  });

  app.get('/api/series/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return ok(await catalog.seriesDetail(id, request.profileId));
  });

  app.get('/api/series/:id/seasons', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const detail = await catalog.seriesDetail(id, request.profileId);
    return ok(detail.seasons);
  });

  app.get('/api/genres', async () => ok(await catalog.genres()));

  app.get('/api/genres/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(64) }), request.params);
    const genre = await catalog.genreBySlug(slug);
    const [movies, series] = await Promise.all([
      catalog.movies({ where: { genres: { some: { id: genre.id } } }, orderBy: { addedAt: 'desc' }, take: 200 }),
      catalog.series({ where: { genres: { some: { id: genre.id } } }, orderBy: { addedAt: 'desc' }, take: 100 }),
    ]);
    return ok({ genre: { id: genre.id, name: genre.name, slug: genre.slug }, items: await catalog.decorate([...movies, ...series], request.profileId) });
  });

  /* ------------------------------ Search ------------------------------ */
  app.get('/api/search', async (request) => {
    const q = parse(searchQuerySchema, request.query);
    const genres = await catalog.genres();
    if (!q.q) {
      const result: SearchResult = { query: '', items: [], genres, total: 0 };
      return ok(result);
    }
    const hits = await ctx.search.search(q.q, q.limit);
    const movieIds = hits.filter((h) => h.kind === 'movie').map((h) => h.id);
    const seriesIds = hits.filter((h) => h.kind === 'series').map((h) => h.id);
    const [movies, series] = await Promise.all([
      catalog.movies({ where: { id: { in: movieIds } } }),
      catalog.series({ where: { id: { in: seriesIds } } }),
    ]);
    const rank = new Map(hits.map((h, i) => [`${h.kind}:${h.id}`, i]));
    const items = [...movies, ...series].sort((a, b) => (rank.get(`${a.kind}:${a.id}`) ?? 0) - (rank.get(`${b.kind}:${b.id}`) ?? 0));
    const needle = q.q.toLowerCase();
    const result: SearchResult = {
      query: q.q,
      items: await catalog.decorate(items, request.profileId),
      genres: genres.filter((g) => g.name.toLowerCase().includes(needle)),
      total: items.length,
    };
    return ok(result);
  });

  app.get('/api/search/suggest', async (request) => {
    const q = parse(suggestQuerySchema, request.query);
    const hits = await ctx.search.search(q.q, 8);
    const [movies, series] = await Promise.all([
      db.movie.findMany({ where: { AND: [playableMovie, { id: { in: hits.filter((h) => h.kind === 'movie').map((h) => h.id) } }] }, select: { id: true, title: true, year: true, posterImage: true, backdropImage: true, accent: true } }),
      db.series.findMany({ where: { AND: [playableSeries, { id: { in: hits.filter((h) => h.kind === 'series').map((h) => h.id) } }] }, select: { id: true, title: true, year: true, posterImage: true, backdropImage: true, accent: true } }),
    ]);
    const all: SearchSuggestion[] = [
      ...movies.map((m) => ({ id: m.id, kind: 'movie' as const, title: m.title, year: m.year, posterUrl: LocalImageServer.urlFor(m.posterImage ?? m.backdropImage), accent: m.accent })),
      ...series.map((s) => ({ id: s.id, kind: 'series' as const, title: s.title, year: s.year, posterUrl: LocalImageServer.urlFor(s.posterImage ?? s.backdropImage), accent: s.accent })),
    ];
    const order = new Map(hits.map((h, i) => [h.id, i]));
    return ok(all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(0, 8));
  });

  /* ------------------------------ My List ------------------------------ */
  app.get('/api/my-list', async (request) => ok(await catalog.myList(request.profileId)));

  app.post('/api/my-list', async (request) => {
    const body = parse(myListSchema, request.body);
    const userId = request.profileId;
    if (body.kind === 'movie') {
      if (!(await db.movie.findUnique({ where: { id: body.id }, select: { id: true } }))) throw notFound('Movie');
      await db.favorite.upsert({ where: { userId_movieId: { userId, movieId: body.id } }, create: { userId, movieId: body.id }, update: {} });
    } else {
      if (!(await db.series.findUnique({ where: { id: body.id }, select: { id: true } }))) throw notFound('Series');
      await db.favorite.upsert({ where: { userId_seriesId: { userId, seriesId: body.id } }, create: { userId, seriesId: body.id }, update: {} });
    }
    return ok({ inMyList: true });
  });

  app.delete('/api/my-list/:kind/:id', async (request) => {
    const params = parse(z.object({ kind: z.enum(['movie', 'series']), id: idSchema }), request.params);
    await db.favorite.deleteMany({
      where: { userId: request.profileId, ...(params.kind === 'movie' ? { movieId: params.id } : { seriesId: params.id }) },
    });
    return ok({ inMyList: false });
  });

  /* ------------------------------ Continue Watching ------------------------------ */
  app.get('/api/continue-watching', async (request) => {
    await ctx.progress.flush();
    return ok(await catalog.continueWatching(request.profileId));
  });

  app.post('/api/watch-progress', async (request) => {
    const body = parse(watchProgressSchema, request.body);
    const immediate = (request.query as { flush?: string } | undefined)?.flush === '1';
    const result = await ctx.progress.record(request.profileId, body, immediate);
    return ok(result);
  });

  app.delete('/api/continue-watching/:videoId', async (request) => {
    const { videoId } = parse(z.object({ videoId: idSchema }), request.params);
    await ctx.progress.flush();
    const row = await db.continueWatching.findUnique({ where: { userId_videoFileId: { userId: request.profileId, videoFileId: videoId } } });
    if (row?.seriesId) {
      await db.continueWatching.updateMany({ where: { userId: request.profileId, seriesId: row.seriesId }, data: { hidden: true } });
    } else {
      await db.continueWatching.updateMany({ where: { userId: request.profileId, videoFileId: videoId }, data: { hidden: true } });
    }
    return ok({ removed: true });
  });
}
