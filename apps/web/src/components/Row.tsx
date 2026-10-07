import type { HomeRow } from '@taazastream/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ContinueCard, LandscapeCard, PosterCard, RankedCard } from './TitleCard';

interface RowShellProps {
  title: string;
  href?: string;
  variant: HomeRow['variant'];
  children: ReactNode;
  id?: string;
}

/** Horizontally scrolling row with snap points and desktop arrow buttons. */
export function RowShell({ title, href, variant, children, id }: RowShellProps) {
  const track = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    update();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);

  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  const headingId = id ? `row-${id}` : undefined;

  return (
    <section className="group/row relative" aria-labelledby={headingId}>
      <div className="page-x mb-2.5 flex items-end justify-between gap-4 md:mb-3">
        <h2
          id={headingId}
          className="font-display text-lg font-semibold tracking-tight md:text-xl lg:text-2xl"
        >
          {title}
        </h2>
        {href && (
          <Link
            to={href}
            className="shrink-0 text-xs font-medium text-muted transition hover:text-fg md:text-sm"
          >
            See all
          </Link>
        )}
      </div>
      <div className="relative">
        <div
          ref={track}
          onScroll={update}
          data-variant={variant}
          className="row-track page-x flex snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain pt-1 pb-4 scrollbar-none md:scroll-px-10"
        >
          {children}
        </div>
        {canLeft && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Scroll ${title} left`}
            onClick={() => scroll(-1)}
            className="absolute top-0 bottom-4 left-0 z-10 hidden w-10 items-center justify-center bg-gradient-to-r from-ink/90 to-transparent text-white opacity-0 transition group-hover/row:opacity-100 md:flex lg:w-14"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
        )}
        {canRight && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Scroll ${title} right`}
            onClick={() => scroll(1)}
            className="absolute top-0 right-0 bottom-4 z-10 hidden w-10 items-center justify-center bg-gradient-to-l from-ink/90 to-transparent text-white opacity-0 transition group-hover/row:opacity-100 md:flex lg:w-14"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        )}
      </div>
    </section>
  );
}

export function Row({
  row,
  onRemoveContinue,
}: {
  row: HomeRow;
  onRemoveContinue?: (videoId: string) => void;
}) {
  return (
    <RowShell title={row.title} href={row.href} variant={row.variant} id={row.id}>
      {row.variant === 'continue'
        ? (row.continueItems ?? []).map((c) => (
            <div key={c.videoId} className="snap-start">
              <ContinueCard
                item={c}
                onRemove={onRemoveContinue ? () => onRemoveContinue(c.videoId) : undefined}
              />
            </div>
          ))
        : row.items.map((item, i) => (
            <div key={`${item.kind}-${item.id}`} className="snap-start">
              {row.variant === 'landscape' ? (
                <LandscapeCard item={item} />
              ) : row.variant === 'ranked' ? (
                <RankedCard item={item} rank={i + 1} />
              ) : (
                <PosterCard item={item} />
              )}
            </div>
          ))}
    </RowShell>
  );
}
