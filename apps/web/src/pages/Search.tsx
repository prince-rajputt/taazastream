import { Search as SearchIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { SearchBox } from '../components/SearchBox';
import { EmptyState, ErrorState, GridSkeleton } from '../components/States';
import { useDocumentTitle } from '../lib/hooks';
import { useMyList, useSearch } from '../lib/queries';
import { PageHeader, TitleGrid } from './Browse';

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, isLoading, error, refetch } = useSearch(q);
  useDocumentTitle(q ? `Search: ${q}` : 'Search');

  return (
    <div className="page-x pt-24 md:pt-28">
      <div className="mb-8 max-w-xl md:hidden">
        <SearchBox key={q} initial={q} />
      </div>
      <PageHeader title={q ? `Results for “${q}”` : 'Search'} />
      {!q ? (
        <EmptyState icon={<SearchIcon className="h-7 w-7" />} title="Find something to watch">
          Search by title, genre, year, cast or description. Search runs on your server, so it works
          without internet.
        </EmptyState>
      ) : isLoading ? (
        <GridSkeleton count={12} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          {data && data.genres.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {data.genres.map((g) => (
                <Link
                  key={g.id}
                  to={`/genre/${g.slug}`}
                  className="rounded-full border border-brand-500/40 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-300"
                >
                  Genre: {g.name}
                </Link>
              ))}
            </div>
          )}
          {data?.items.length ? (
            <TitleGrid items={data.items} />
          ) : (
            <EmptyState icon={<SearchIcon className="h-7 w-7" />} title="No matches">
              Nothing in your library matches “{q}”. Try a shorter word or another spelling.
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}

export function MyListPage() {
  const { data, isLoading, error, refetch } = useMyList();
  useDocumentTitle('My List');
  return (
    <div className="page-x pt-24 md:pt-28">
      <PageHeader title="My List" />
      {isLoading ? (
        <GridSkeleton count={12} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data?.length ? (
        <TitleGrid items={data} />
      ) : (
        <EmptyState title="Your list is empty">
          Tap “My List” on any movie or series to save it here for later.
        </EmptyState>
      )}
    </div>
  );
}
