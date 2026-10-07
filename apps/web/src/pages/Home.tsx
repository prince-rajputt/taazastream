import { FolderPlus } from 'lucide-react';
import { Link } from 'react-router';
import { Hero } from '../components/Hero';
import { Row } from '../components/Row';
import { EmptyState, ErrorState, HeroSkeleton, RowSkeleton } from '../components/States';
import { useDocumentTitle } from '../lib/hooks';
import { useHome, useRemoveContinue } from '../lib/queries';

export default function HomePage() {
  useDocumentTitle(null);
  const { data, isLoading, error, refetch } = useHome();
  const remove = useRemoveContinue();

  if (isLoading) {
    return (
      <div>
        <HeroSkeleton />
        <div className="relative z-10 -mt-24 space-y-10">
          <RowSkeleton variant="landscape" />
          <RowSkeleton />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pt-28">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (data.libraryEmpty) {
    return (
      <div className="relative min-h-[80svh] overflow-hidden pt-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(255_107_53/0.18),transparent_70%)]" />
        <EmptyState
          icon={<FolderPlus className="h-7 w-7" />}
          title="Your cinema is ready — add some videos"
          action={
            <Link to="/admin/folders" className="inline-flex h-12 items-center rounded-full bg-gradient-brand px-7 font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:brightness-110">
              Add a media folder
            </Link>
          }
        >
          Point TaazaStream at the folders on your server PC that hold your movies and series (for example
          <span className="font-mono text-fg"> D:\TaazaStream\Movies</span>), then scan the library. Your videos stay on the server and
          stream over your Wi-Fi.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <Hero items={data.hero} />
      <div className="relative z-10 -mt-16 space-y-8 md:-mt-28 md:space-y-11">
        {data.rows.map((row) => (
          <Row key={row.id} row={row} onRemoveContinue={row.variant === 'continue' ? (id) => remove.mutate(id) : undefined} />
        ))}
        {data.genres.length > 0 && (
          <section className="page-x" aria-labelledby="genres-heading">
            <h2 id="genres-heading" className="mb-3 font-display text-lg font-semibold md:text-2xl">
              Genres
            </h2>
            <div className="flex flex-wrap gap-2">
              {data.genres.map((g) => (
                <Link
                  key={g.id}
                  to={`/genre/${g.slug}`}
                  className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-white/85 transition hover:border-brand-500/60 hover:bg-surface-2 hover:text-white"
                >
                  {g.name} <span className="ml-1 text-faint">{g.count}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
