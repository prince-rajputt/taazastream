import type { Logger } from 'pino';
import type { Db, LocalDatabase } from './database';

export interface SearchHit {
  kind: 'movie' | 'series';
  id: string;
  score: number;
}

interface CastEntry {
  name?: string;
}

function castNames(json: string): string {
  try {
    const arr = JSON.parse(json) as CastEntry[];
    return Array.isArray(arr)
      ? arr
          .map((c) => c?.name ?? '')
          .filter(Boolean)
          .join(' ')
      : '';
  } catch {
    return '';
  }
}

/** Builds an FTS5 query: every token must match as a prefix ("inter stel" → "inter"* "stel"*). */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

/**
 * Local search over SQLite FTS5 (title, genres, year, cast, overview). Works fully offline.
 * Falls back to indexed LIKE queries when FTS5 is not compiled in.
 */
export class SearchService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly log: Logger,
  ) {}

  private get db(): Db {
    return this.database.client;
  }

  async indexMovie(id: string): Promise<void> {
    if (!this.database.hasFullTextSearch) return;
    const m = await this.db.movie.findUnique({ where: { id }, include: { genres: true } });
    await this.db.$executeRawUnsafe(
      'DELETE FROM search_fts WHERE kind = ? AND ref_id = ?',
      'movie',
      id,
    );
    if (!m) return;
    await this.db.$executeRawUnsafe(
      'INSERT INTO search_fts (kind, ref_id, title, genres, year, people, overview) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'movie',
      m.id,
      [m.title, m.originalTitle ?? ''].join(' '),
      m.genres.map((g) => g.name).join(' '),
      m.year ? String(m.year) : '',
      [castNames(m.cast), m.director ?? ''].join(' '),
      [m.tagline ?? '', m.overview ?? ''].join(' '),
    );
  }

  async indexSeries(id: string): Promise<void> {
    if (!this.database.hasFullTextSearch) return;
    const s = await this.db.series.findUnique({
      where: { id },
      include: { genres: true, episodes: { select: { title: true }, take: 200 } },
    });
    await this.db.$executeRawUnsafe(
      'DELETE FROM search_fts WHERE kind = ? AND ref_id = ?',
      'series',
      id,
    );
    if (!s) return;
    await this.db.$executeRawUnsafe(
      'INSERT INTO search_fts (kind, ref_id, title, genres, year, people, overview) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'series',
      s.id,
      s.title,
      s.genres.map((g) => g.name).join(' '),
      s.year ? String(s.year) : '',
      castNames(s.cast),
      [s.overview ?? '', s.episodes.map((e) => e.title).join(' ')].join(' '),
    );
  }

  async remove(kind: 'movie' | 'series', id: string): Promise<void> {
    if (!this.database.hasFullTextSearch) return;
    await this.db.$executeRawUnsafe(
      'DELETE FROM search_fts WHERE kind = ? AND ref_id = ?',
      kind,
      id,
    );
  }

  async rebuild(): Promise<void> {
    if (!this.database.hasFullTextSearch) return;
    const started = Date.now();
    await this.db.$executeRawUnsafe('DELETE FROM search_fts');
    const movies = await this.db.movie.findMany({ select: { id: true } });
    const series = await this.db.series.findMany({ select: { id: true } });
    for (const m of movies) await this.indexMovie(m.id);
    for (const s of series) await this.indexSeries(s.id);
    this.log.info(
      { ms: Date.now() - started, movies: movies.length, series: series.length },
      'search index rebuilt',
    );
  }

  async search(query: string, limit = 40): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    if (this.database.hasFullTextSearch) {
      const fts = toFtsQuery(q);
      if (!fts) return [];
      try {
        // bm25 weights: kind, ref_id (unindexed), title, genres, year, people, overview.
        const rows = await this.db.$queryRawUnsafe<
          { kind: string; ref_id: string; score: number }[]
        >(
          `SELECT kind, ref_id, bm25(search_fts, 0, 0, 12.0, 4.0, 4.0, 3.0, 1.0) AS score
             FROM search_fts WHERE search_fts MATCH ? ORDER BY score LIMIT ?`,
          fts,
          limit,
        );
        return rows.map((r) => ({
          kind: r.kind as 'movie' | 'series',
          id: r.ref_id,
          score: Number(r.score),
        }));
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'FTS query failed, using fallback');
      }
    }
    return this.fallbackSearch(q, limit);
  }

  private async fallbackSearch(q: string, limit: number): Promise<SearchHit[]> {
    const year = /^\d{4}$/.test(q) ? Number(q) : undefined;
    const [movies, series] = await Promise.all([
      this.db.movie.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { overview: { contains: q } },
            { cast: { contains: q } },
            { genres: { some: { name: { contains: q } } } },
            ...(year ? [{ year }] : []),
          ],
        },
        select: { id: true },
        take: limit,
      }),
      this.db.series.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { overview: { contains: q } },
            { cast: { contains: q } },
            { genres: { some: { name: { contains: q } } } },
            ...(year ? [{ year }] : []),
          ],
        },
        select: { id: true },
        take: limit,
      }),
    ]);
    return [
      ...movies.map((m) => ({ kind: 'movie' as const, id: m.id, score: 0 })),
      ...series.map((s) => ({ kind: 'series' as const, id: s.id, score: 0 })),
    ].slice(0, limit);
  }
}
