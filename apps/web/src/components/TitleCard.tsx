import { formatRuntime, formatTimecode, type ContinueWatchingItem, type TitleCard as Card } from '@taazastream/shared';
import { Play, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Artwork } from './Artwork';

function metaLine(item: Card): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  if (item.kind === 'series') {
    if (item.seasonCount) parts.push(`${item.seasonCount} Season${item.seasonCount > 1 ? 's' : ''}`);
  } else if (item.durationSec) parts.push(formatRuntime(item.durationSec));
  return parts.join(' · ');
}

export function hrefFor(item: { kind: 'movie' | 'series'; id: string }) {
  return item.kind === 'movie' ? `/movie/${item.id}` : `/series/${item.id}`;
}

function ProgressBar({ percent, className = '' }: { percent: number; className?: string }) {
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-white/20 ${className}`} role="progressbar" aria-valuenow={Math.round(percent * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${Math.max(3, percent * 100)}%` }} />
    </div>
  );
}

/** Portrait (2:3) card used for most rows and grids. */
export function PosterCard({ item }: { item: Card }) {
  const navigate = useNavigate();
  const play = item.kind === 'movie' && item.videoId ? `/watch/${item.videoId}` : null;
  return (
    <div className="group relative">
      <Link
        to={hrefFor(item)}
        className="block rounded-[var(--radius-card)] transition-transform duration-300 ease-[var(--ease-out-soft)] focus-visible:scale-[1.04] md:group-hover:scale-[1.04]"
        aria-label={`${item.title}${item.year ? ` (${item.year})` : ''}`}
      >
        <Artwork
          src={item.posterUrl ?? item.backdropUrl}
          alt={item.title}
          title={item.title}
          designed={!item.posterUrl}
          accent={item.accent}
          className="aspect-[2/3] rounded-[var(--radius-card)] ring-1 ring-line shadow-lg shadow-black/40 md:group-hover:shadow-2xl md:group-hover:shadow-black/70"
        />
        {item.progress && <ProgressBar percent={item.progress.percent} className="absolute right-2 bottom-2 left-2" />}
      </Link>
      {play && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => navigate(play)}
          className="absolute top-1/2 left-1/2 hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 scale-90 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-xl transition duration-300 md:flex md:group-hover:scale-100 md:group-hover:opacity-100"
        >
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </button>
      )}
      <div className="mt-2 px-0.5">
        <p className="truncate text-sm font-medium text-fg">{item.title}</p>
        <p className="truncate text-xs text-muted">{metaLine(item) || ' '}</p>
      </div>
    </div>
  );
}

/** Landscape (16:9) card with title over the artwork. */
export function LandscapeCard({ item }: { item: Card }) {
  return (
    <Link
      to={hrefFor(item)}
      className="group block rounded-[var(--radius-card)] transition-transform duration-300 ease-[var(--ease-out-soft)] focus-visible:scale-[1.03] md:hover:scale-[1.03]"
      aria-label={item.title}
    >
      <div className="relative">
        <Artwork src={item.backdropUrl ?? item.posterUrl} alt={item.title} accent={item.accent} className="aspect-video rounded-[var(--radius-card)] ring-1 ring-line" />
        <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <div className="absolute right-3 bottom-2.5 left-3">
          <p className="font-display text-base leading-tight font-semibold text-white drop-shadow line-clamp-2 md:text-lg">{item.title}</p>
          <p className="mt-0.5 text-xs text-white/70">{metaLine(item)}</p>
        </div>
        {item.progress && <ProgressBar percent={item.progress.percent} className="absolute right-3 bottom-0.5 left-3" />}
        <span className="absolute top-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </span>
      </div>
    </Link>
  );
}

/** "Top 10" style ranked card. */
export function RankedCard({ item, rank }: { item: Card; rank: number }) {
  return (
    <Link to={hrefFor(item)} className="group flex items-end rounded-[var(--radius-card)]" aria-label={`Number ${rank}: ${item.title}`}>
      <span
        className="font-display -mr-3 shrink-0 text-[clamp(4.5rem,9vw,8rem)] leading-[0.8] font-black text-transparent select-none"
        style={{ WebkitTextStroke: '2px rgb(255 255 255 / 0.35)' }}
        aria-hidden="true"
      >
        {rank}
      </span>
      <Artwork
        src={item.posterUrl ?? item.backdropUrl}
        alt={item.title}
        title={item.title}
        designed={!item.posterUrl}
        accent={item.accent}
        className="relative aspect-[2/3] w-[62%] shrink-0 rounded-[var(--radius-card)] ring-1 ring-line shadow-xl shadow-black/50 transition-transform duration-300 group-hover:scale-[1.04] group-focus-visible:scale-[1.04]"
      />
    </Link>
  );
}

/** Continue Watching card: resume point, progress, remove. */
export function ContinueCard({ item, onRemove }: { item: ContinueWatchingItem; onRemove?: () => void }) {
  const remaining = Math.max(0, item.durationSec - item.positionSec);
  return (
    <div className="group relative">
      <Link
        to={`/watch/${item.videoId}`}
        className="block rounded-[var(--radius-card)] transition-transform duration-300 focus-visible:scale-[1.03] md:group-hover:scale-[1.03]"
        aria-label={`Resume ${item.title}${item.subtitle ? `, ${item.subtitle}` : ''} at ${formatTimecode(item.positionSec)}`}
      >
        <div className="relative">
          <Artwork src={item.backdropUrl ?? item.posterUrl} alt={item.title} accent={item.accent} className="aspect-video rounded-[var(--radius-card)] ring-1 ring-line" />
          <div className="absolute inset-0 rounded-[var(--radius-card)] bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          <span className="absolute top-1/2 left-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-black/40 text-white backdrop-blur transition group-hover:scale-110 group-hover:bg-white group-hover:text-black">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
          <ProgressBar percent={item.percent} className="absolute right-3 bottom-2.5 left-3" />
        </div>
        <div className="mt-2 px-0.5">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className="truncate text-xs text-muted">
            {item.subtitle ? `${item.subtitle} · ` : ''}
            {item.positionSec > 0 ? `Resume at ${formatTimecode(item.positionSec)}` : 'Up next'}
            {remaining > 60 ? ` · ${formatRuntime(remaining)} left` : ''}
          </p>
        </div>
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.title} from Continue Watching`}
          className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-white focus-visible:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
