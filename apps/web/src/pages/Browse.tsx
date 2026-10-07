import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PosterCard } from '../components/TitleCard';
import { EmptyState, ErrorState, GridSkeleton } from '../components/States';
import { useDocumentTitle } from '../lib/hooks';
import { useBrowse, useGenre, useGenres } from '../lib/queries';
import type { TitleCard } from '@taazastream/shared';

const SORTS = [
  { id: 'added', label: 'Recently added' },
  { id: 'title', label: 'A–Z' },
  { id: 'year', label: 'Release year' },
  { id: 'rating', label: 'Rating' },
  { id: 'popular', label: 'Most watched' },
];

export function TitleGrid({ items }: { items: TitleCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {items.map((item) => (
        <PosterCard key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <h1 className="font-display text-3xl font-bold tracking-tight md:text-5xl">{title}</h1>
      {children}
    </div>
  );
}

export default function BrowsePage({ kind }: { kind: 'movies' | 'series' }) {
  const [params, setParams] = useSearchParams();
  const genre = params.get('genre') ?? undefined;
  const sort = params.get('sort') ?? 'added';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const { data, isLoading, error, refetch, isFetching } = useBrowse(kind, { genre, sort, page });
  const { data: genres } = useGenres();
  const title = kind === 'movies' ? 'Movies' : 'Series';
  useDocumentTitle(title);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page-x pt-24 md:pt-28">
      <PageHeader title={title}>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="genre">Genre</label>
          <select id="genre" value={genre ?? ''} onChange={(e) => set({ genre: e.target.value || undefined })} className="h-10 rounded-full border border-line bg-surface px-4 text-sm">
            <option value="">All genres</option>
            {genres?.map((g) => (
              <option key={g.id} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="sort">Sort by</label>
          <select id="sort" value={sort} onChange={(e) => set({ sort: e.target.value })} className="h-10 rounded-full border border-line bg-surface px-4 text-sm">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </PageHeader>
      {isLoading ? (
        <GridSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data?.items.length ? (
        <EmptyState title={`No ${kind} found`}>{genre ? 'Try another genre.' : 'Add a media folder and scan your library from the admin dashboard.'}</EmptyState>
      ) : (
        <div className={isFetching ? 'opacity-70 transition-opacity' : ''}>
          <p className="mb-4 text-sm text-muted">{data.total} titles</p>
          <TitleGrid items={data.items} />
          {pages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-3">
              <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} className="flex h-10 w-10 items-center justify-center rounded-full border border-line disabled:opacity-30" aria-label="Previous page">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm text-muted">
                Page {page} of {pages}
              </span>
              <button type="button" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} className="flex h-10 w-10 items-center justify-center rounded-full border border-line disabled:opacity-30" aria-label="Next page">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GenrePage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useGenre(slug);
  useDocumentTitle(data?.genre.name);
  return (
    <div className="page-x pt-24 md:pt-28">
      <PageHeader title={data?.genre.name ?? 'Genre'} />
      {isLoading ? <GridSkeleton /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : <TitleGrid items={data?.items ?? []} />}
    </div>
  );
}

export function GenresIndexPage() {
  const { data, isLoading } = useGenres();
  useDocumentTitle('Genres');
  return (
    <div className="page-x pt-24 md:pt-28">
      <PageHeader title="Genres" />
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <EmptyState title="No genres yet">Genres come from .nfo/.json metadata next to your videos, or can be set in the admin library editor.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {data.map((g, i) => (
            <Link
              key={g.id}
              to={`/genre/${g.slug}`}
              className="group relative flex h-24 items-end overflow-hidden rounded-xl border border-line p-4 transition hover:border-white/25 md:h-32"
              style={{ background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 70% 32%), #13131c 75%)` }}
            >
              <span className="font-display text-lg font-semibold md:text-2xl">{g.name}</span>
              <span className="absolute top-3 right-4 text-xs text-white/60">{g.count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
