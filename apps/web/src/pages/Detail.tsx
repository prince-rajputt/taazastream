import {
  formatRuntime,
  formatTimecode,
  slugify,
  type EpisodeInfo,
  type TitleCard,
} from '@taazastream/shared';
import { Captions, Check, ChevronDown, Languages, Play, Plus, RotateCcw, Star } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Artwork } from '../components/Artwork';
import { RowShell } from '../components/Row';
import { ErrorState, HeroSkeleton } from '../components/States';
import { PosterCard } from '../components/TitleCard';
import { languageName } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useMovie, useSeries, useToggleMyList } from '../lib/queries';

function DetailHero({
  item,
  children,
  meta,
}: {
  item: TitleCard & { tagline?: string | null };
  children: ReactNode;
  meta: ReactNode;
}) {
  return (
    <section className="relative">
      <div className="absolute inset-0 h-[78svh] max-h-[900px] overflow-hidden">
        <Artwork
          src={item.backdropUrl ?? item.posterUrl}
          alt=""
          accent={item.accent}
          priority
          className="h-full w-full"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/70 to-ink/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-black/40" />
      </div>
      <div className="page-x relative flex min-h-[78svh] max-h-[900px] items-end pt-28 pb-10 md:pb-16">
        <div className="flex w-full flex-col gap-6 md:flex-row md:items-end md:gap-10">
          <Artwork
            src={item.posterUrl ?? item.backdropUrl}
            alt={`${item.title} poster`}
            title={item.title}
            designed={!item.posterUrl}
            accent={item.accent}
            priority
            className="hidden aspect-[2/3] w-56 shrink-0 rounded-xl shadow-2xl shadow-black/70 ring-1 ring-white/10 md:block lg:w-64"
          />
          <div className="max-w-3xl animate-rise-in">
            <h1 className="font-display text-[clamp(2.2rem,5.5vw,4.5rem)] leading-[0.95] font-bold tracking-tight text-balance">
              {item.title}
            </h1>
            {item.tagline && <p className="mt-3 text-lg text-brand-300 italic">{item.tagline}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/80 md:text-base">
              {meta}
            </div>
            {item.genres.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {item.genres.map((g) => (
                  <Link
                    key={g}
                    to={`/genre/${slugify(g)}`}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/85 hover:bg-white/10"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}
            {item.overview && (
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/85 md:text-lg">
                {item.overview}
              </p>
            )}
            <div className="mt-7 flex flex-wrap items-center gap-3">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MyListButton({
  kind,
  id,
  inList,
}: {
  kind: 'movie' | 'series';
  id: string;
  inList: boolean;
}) {
  const toggle = useToggleMyList();
  return (
    <button
      type="button"
      aria-pressed={inList}
      onClick={() => toggle.mutate({ kind, id, add: !inList })}
      className="glass inline-flex h-12 items-center gap-2 rounded-full px-6 font-semibold transition hover:bg-white/15 md:h-14 md:px-7 md:text-lg"
    >
      {inList ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}{' '}
      {inList ? 'In My List' : 'My List'}
    </button>
  );
}

function PlayButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-8 font-semibold text-black shadow-xl shadow-black/30 transition hover:bg-white/85 active:scale-[0.98] md:h-14 md:px-10 md:text-lg"
    >
      <Play className="h-5 w-5 fill-current" /> {label}
    </button>
  );
}

function Dot({ children }: { children: ReactNode }) {
  return (
    <span className="after:ml-3 after:text-white/30 after:content-['•'] last:after:content-none">
      {children}
    </span>
  );
}

function Related({ items }: { items: TitleCard[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-6">
      <RowShell title="More like this" variant="poster">
        {items.map((i) => (
          <div key={`${i.kind}-${i.id}`} className="snap-start">
            <PosterCard item={i} />
          </div>
        ))}
      </RowShell>
    </div>
  );
}

export function MovieDetailPage() {
  const { id = '' } = useParams();
  const { data: m, isLoading, error, refetch } = useMovie(id);
  useDocumentTitle(m?.title);

  if (isLoading) return <HeroSkeleton />;
  if (error || !m)
    return (
      <div className="pt-28">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );

  const video = m.videos.find((v) => v.available) ?? m.videos[0];
  const audio = [
    ...new Map(
      (video?.audioTracks ?? []).map((a) => [a.language ?? a.title ?? a.codec, a]),
    ).values(),
  ];
  const subs = video?.subtitles ?? [];

  return (
    <div>
      <DetailHero
        item={m}
        meta={
          <>
            {m.rating != null && (
              <Dot>
                <span className="inline-flex items-center gap-1 font-semibold text-white">
                  <Star className="h-4 w-4 fill-brand-400 text-brand-400" /> {m.rating.toFixed(1)}
                </span>
              </Dot>
            )}
            {m.year && <Dot>{m.year}</Dot>}
            {m.contentRating && (
              <Dot>
                <span className="rounded border border-white/30 px-1.5 py-0.5 text-xs">
                  {m.contentRating}
                </span>
              </Dot>
            )}
            {m.durationSec ? <Dot>{formatRuntime(m.durationSec)}</Dot> : null}
            {video?.height ? (
              <Dot>
                {video.height >= 2000
                  ? '4K'
                  : video.height >= 1000
                    ? 'HD 1080p'
                    : video.height >= 700
                      ? 'HD 720p'
                      : 'SD'}
              </Dot>
            ) : null}
          </>
        }
      >
        {video?.available ? (
          <PlayButton
            to={`/watch/${video.id}`}
            label={m.progress ? `Resume ${formatTimecode(m.progress.positionSec)}` : 'Play'}
          />
        ) : (
          <span className="rounded-full bg-bad/15 px-5 py-3 text-sm text-bad">
            This file is currently unavailable on the server.
          </span>
        )}
        {m.progress && video?.available && (
          <Link
            to={`/watch/${video.id}?start=0`}
            className="glass inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold hover:bg-white/15 md:h-14"
          >
            <RotateCcw className="h-4 w-4" /> Start over
          </Link>
        )}
        <MyListButton kind="movie" id={m.id} inList={!!m.inMyList} />
      </DetailHero>

      <div className="page-x grid gap-8 md:grid-cols-[2fr_1fr] md:gap-16">
        <div className="space-y-5 text-sm">
          {m.progress && (
            <div>
              <div className="mb-2 flex justify-between text-xs text-muted">
                <span>Resume at {formatTimecode(m.progress.positionSec)}</span>
                <span>{formatRuntime(m.progress.durationSec - m.progress.positionSec)} left</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full bg-gradient-brand"
                  style={{ width: `${m.progress.percent * 100}%` }}
                />
              </div>
            </div>
          )}
          {m.cast.length > 0 && (
            <p className="leading-relaxed text-muted">
              <span className="text-faint">Cast: </span>
              {m.cast.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join(', ')}
            </p>
          )}
          {m.director && (
            <p className="text-muted">
              <span className="text-faint">Director: </span>
              {m.director}
            </p>
          )}
        </div>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="mb-1 flex items-center gap-2 text-faint">
              <Languages className="h-4 w-4" /> Audio
            </dt>
            <dd className="text-muted">
              {audio.length
                ? audio
                    .map((a) => languageName(a.language) ?? a.title ?? a.codec.toUpperCase())
                    .join(', ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="mb-1 flex items-center gap-2 text-faint">
              <Captions className="h-4 w-4" /> Subtitles
            </dt>
            <dd className="text-muted">
              {subs.length ? subs.map((s) => s.label).join(', ') : 'None'}
            </dd>
          </div>
        </dl>
      </div>
      <Related items={m.related} />
    </div>
  );
}

function EpisodeRow({ ep }: { ep: EpisodeInfo }) {
  const done = (ep.progress?.percent ?? 0) >= 0.95;
  return (
    <li>
      <Link
        to={ep.videoId ? `/watch/${ep.videoId}` : '#'}
        className="group flex gap-4 rounded-xl p-2 transition hover:bg-white/5 focus-visible:bg-white/5 md:gap-6 md:p-3"
        aria-label={`Episode ${ep.episodeNumber}: ${ep.title}`}
      >
        <span className="hidden w-6 shrink-0 self-center text-center font-display text-xl text-faint md:block">
          {ep.episodeNumber}
        </span>
        <div className="relative w-36 shrink-0 sm:w-44 md:w-56">
          <Artwork
            src={ep.thumbUrl}
            alt=""
            accent="#3b3b52"
            className="aspect-video rounded-lg ring-1 ring-line"
          />
          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur">
              <Play className="ml-0.5 h-4 w-4 fill-white" />
            </span>
          </span>
          {ep.progress && (
            <div className="absolute right-2 bottom-1.5 left-2 h-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full bg-gradient-brand"
                style={{ width: `${Math.max(4, ep.progress.percent * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-medium md:text-lg">
              <span className="md:hidden">{ep.episodeNumber}. </span>
              {ep.title}
            </h3>
            <span className="shrink-0 text-xs text-muted">
              {done ? 'Watched' : formatRuntime(ep.durationSec)}
            </span>
          </div>
          {ep.overview && (
            <p className="mt-1 text-sm leading-relaxed text-muted line-clamp-2 md:line-clamp-3">
              {ep.overview}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

export function SeriesDetailPage() {
  const { id = '' } = useParams();
  const { data: s, isLoading, error, refetch } = useSeries(id);
  useDocumentTitle(s?.title);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const season = useMemo(() => {
    if (!s) return null;
    return (
      s.seasons.find((x) => x.id === seasonId) ??
      s.seasons.find((x) => x.id === s.nextUp?.seasonId) ??
      s.seasons[0] ??
      null
    );
  }, [s, seasonId]);

  if (isLoading) return <HeroSkeleton />;
  if (error || !s)
    return (
      <div className="pt-28">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );

  const next = s.nextUp;
  const resuming = next?.progress && next.progress.percent < 0.95 && next.progress.positionSec > 15;

  return (
    <div>
      <DetailHero
        item={s}
        meta={
          <>
            {s.rating != null && (
              <Dot>
                <span className="inline-flex items-center gap-1 font-semibold text-white">
                  <Star className="h-4 w-4 fill-brand-400 text-brand-400" /> {s.rating.toFixed(1)}
                </span>
              </Dot>
            )}
            {s.year && <Dot>{s.year}</Dot>}
            <Dot>
              {s.seasons.length} Season{s.seasons.length === 1 ? '' : 's'}
            </Dot>
            <Dot>{s.seasons.reduce((n, x) => n + x.episodes.length, 0)} Episodes</Dot>
          </>
        }
      >
        {next?.videoId && (
          <PlayButton
            to={`/watch/${next.videoId}`}
            label={
              resuming
                ? `Resume S${next.seasonNumber}:E${next.episodeNumber}`
                : `Play S${next.seasonNumber}:E${next.episodeNumber}`
            }
          />
        )}
        <MyListButton kind="series" id={s.id} inList={!!s.inMyList} />
      </DetailHero>

      <section className="page-x" aria-labelledby="episodes-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <h2 id="episodes-heading" className="font-display text-xl font-semibold md:text-2xl">
            Episodes
          </h2>
          {s.seasons.length > 1 && (
            <div className="relative">
              <label htmlFor="season" className="sr-only">
                Season
              </label>
              <select
                id="season"
                value={season?.id}
                onChange={(e) => setSeasonId(e.target.value)}
                className="h-11 appearance-none rounded-lg border border-line-strong bg-surface-2 pr-10 pl-4 text-sm font-medium"
              >
                {s.seasons.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title} ({x.episodes.length})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-3 right-3 h-5 w-5 text-muted" />
            </div>
          )}
        </div>
        <ol className="space-y-1">
          {season?.episodes.map((ep) => (
            <EpisodeRow key={ep.id} ep={ep} />
          ))}
        </ol>
        {s.cast.length > 0 && (
          <p className="mt-8 text-sm text-muted">
            <span className="text-faint">Cast: </span>
            {s.cast.map((c) => c.name).join(', ')}
          </p>
        )}
      </section>
      <Related items={s.related} />
    </div>
  );
}
