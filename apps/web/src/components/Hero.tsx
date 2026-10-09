import { formatRuntime, type TitleCard } from '@taazastream/shared';
import { Check, Info, Play, Plus, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useToggleMyList } from '../lib/queries';
import { Artwork } from './Artwork';
import { hrefFor } from './TitleCard';

const ROTATE_MS = 5000;

/** Large cinematic hero with a slow crossfade between featured titles. */
export function Hero({ items }: { items: TitleCard[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const navigate = useNavigate();
  const toggle = useToggleMyList();
  const item = items[index % Math.max(items.length, 1)];

  // Restarts on every slide change, so picking a dot gives that slide a full ROTATE_MS.
  useEffect(() => {
    if (items.length < 2 || paused) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, items.length, paused]);

  if (!item) return null;

  const playHref =
    item.kind === 'movie' ? (item.videoId ? `/watch/${item.videoId}` : null) : hrefFor(item);
  const meta = [
    item.year,
    item.contentRating,
    item.kind === 'movie'
      ? formatRuntime(item.durationSec)
      : item.seasonCount
        ? `${item.seasonCount} Season${item.seasonCount > 1 ? 's' : ''}`
        : null,
  ].filter(Boolean);

  return (
    <section
      className="relative h-[74svh] min-h-[440px] w-full overflow-hidden md:h-[88svh] md:max-h-[980px]"
      aria-roledescription="carousel"
      aria-label="Featured titles"
      // Pause only for keyboard/remote focus; the hero fills most of the screen, so a
      // hover pause meant it almost never rotated on desktop.
      onFocus={(e) => setPaused(e.target.matches(':focus-visible'))}
      onBlur={() => setPaused(false)}
    >
      {items.map((it, i) => (
        <div
          key={it.id}
          className={`absolute inset-0 transition-opacity duration-[1200ms] ease-[var(--ease-out-soft)] ${i === index ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={i !== index}
        >
          <Artwork
            src={it.backdropUrl ?? it.posterUrl}
            alt=""
            accent={it.accent}
            priority={i === 0}
            className={`h-full w-full ${i === index ? 'scale-105' : 'scale-100'} transition-transform duration-[5000ms] ease-linear`}
          />
        </div>
      ))}

      {/* Cinematic grading: vignette + bottom fade into the page. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/55 to-transparent md:via-ink/40" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-ink/30" />
      <div
        className="pointer-events-none absolute inset-0 opacity-50 mix-blend-soft-light"
        style={{
          background: `radial-gradient(80% 60% at 20% 70%, ${item.accent}66, transparent 70%)`,
        }}
      />

      <div className="page-x absolute inset-x-0 bottom-[max(14%,5.5rem)] md:bottom-[max(20%,9.5rem)]">
        <div key={item.id} className="max-w-xl animate-rise-in lg:max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-2 text-[0.7rem] font-semibold tracking-[0.25em] text-brand-300 uppercase md:text-xs">
            <span className="h-px w-6 bg-brand-400" />
            {item.kind === 'series' ? 'Series' : 'Film'}
            {item.genres[0] ? ` · ${item.genres.slice(0, 2).join(' · ')}` : ''}
          </p>
          <h1 className="font-display text-[clamp(2.2rem,6vw,4.75rem)] leading-[0.95] font-bold tracking-tight text-balance drop-shadow-2xl">
            {item.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80 md:text-base">
            {item.rating != null && (
              <span className="inline-flex items-center gap-1 font-semibold text-white">
                <Star className="h-4 w-4 fill-brand-400 text-brand-400" /> {item.rating.toFixed(1)}
              </span>
            )}
            {meta.map((m) => (
              <span
                key={String(m)}
                className="after:ml-3 after:text-white/30 after:content-['•'] last:after:content-none"
              >
                {m}
              </span>
            ))}
          </div>
          {item.overview && (
            <p className="mt-4 hidden max-w-xl text-base leading-relaxed text-white/80 line-clamp-3 sm:block md:text-lg">
              {item.overview}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {playHref && (
              <button
                type="button"
                onClick={() => navigate(playHref)}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-black shadow-xl shadow-black/30 transition hover:bg-white/85 active:scale-[0.98] md:h-14 md:px-9 md:text-lg"
              >
                <Play className="h-5 w-5 fill-current" /> {item.progress ? 'Resume' : 'Play'}
              </button>
            )}
            <button
              type="button"
              onClick={() => toggle.mutate({ kind: item.kind, id: item.id, add: !item.inMyList })}
              aria-pressed={!!item.inMyList}
              className="glass inline-flex h-12 items-center gap-2 rounded-full px-6 text-base font-semibold text-white transition hover:bg-white/15 md:h-14 md:px-7 md:text-lg"
            >
              {item.inMyList ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />} My List
            </button>
            <Link
              to={hrefFor(item)}
              aria-label={`More info about ${item.title}`}
              className="glass inline-flex h-12 w-12 items-center justify-center rounded-full text-white transition hover:bg-white/15 md:h-14 md:w-14"
            >
              <Info className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <div
          className="page-x absolute right-0 bottom-[max(6%,5rem)] flex gap-2 md:bottom-[max(12%,8.5rem)]"
          role="tablist"
          aria-label="Choose featured title"
        >
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={it.title}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? 'w-8 bg-white' : 'w-3 bg-white/35 hover:bg-white/60'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
