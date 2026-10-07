import {
  formatBytes,
  formatTimecode,
  type AdminLibraryItem,
  type AdminVideoFile,
  type CastMember,
} from '@taazastream/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, Film, ImageUp, Search, Trash2, Tv, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Artwork } from '../components/Artwork';
import { Spinner } from '../components/States';
import { api, qs } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { AdminHeader } from './AdminApp';
import {
  Badge,
  Button,
  Card,
  Drawer,
  ErrorText,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
} from './ui';

interface MovieEdit {
  id: string;
  kind: 'movie';
  title: string;
  year: number | null;
  overview: string | null;
  tagline: string | null;
  genres: string[];
  cast: CastMember[];
  director: string | null;
  rating: number | null;
  contentRating: string | null;
  featured: boolean;
  metadataLocked: boolean;
  posterUrl: string | null;
  backdropUrl: string | null;
  accent: string;
  videos: AdminVideoFile[];
}

interface SeriesEdit extends Omit<MovieEdit, 'kind' | 'videos' | 'tagline' | 'director'> {
  kind: 'series';
  seasons: {
    id: string;
    number: number;
    title: string | null;
    episodes: {
      id: string;
      number: number;
      title: string;
      overview: string | null;
      thumbUrl: string | null;
      videos: AdminVideoFile[];
    }[];
  }[];
}

const castToText = (cast: CastMember[]) =>
  cast.map((c) => (c.role ? `${c.name} as ${c.role}` : c.name)).join('\n');
const textToCast = (text: string): CastMember[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, role] = l.split(/\s+as\s+/i);
      return { name: name!.trim(), role: role?.trim() || null };
    });

function VideoFiles({ videos, onChanged }: { videos: AdminVideoFile[]; onChanged: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [lang, setLang] = useState('en');
  const upload = useMutation({
    mutationFn: ({ videoId, file }: { videoId: string; file: File }) => {
      const fd = new FormData();
      fd.append('language', lang);
      fd.append('label', file.name.replace(/\.(srt|vtt)$/i, ''));
      fd.append('file', file);
      return api.upload(`/api/admin/videos/${videoId}/subtitles`, fd);
    },
    onSuccess: onChanged,
  });
  const delSub = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/subtitles/${id}`),
    onSuccess: onChanged,
  });
  const delVideo = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/videos/${id}`),
    onSuccess: onChanged,
  });

  return (
    <div className="space-y-3">
      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && target) upload.mutate({ videoId: target, file });
          e.target.value = '';
        }}
      />
      <ErrorText error={upload.error ?? delSub.error ?? delVideo.error} />
      {videos.map((v) => (
        <div key={v.id} className="rounded-xl border border-line bg-ink p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-xs break-all text-muted">{v.path}</p>
            {v.missing && <Badge tone="bad">missing</Badge>}
          </div>
          <p className="mt-2 text-xs text-faint">
            {[
              v.container,
              v.videoCodec,
              v.audioCodec,
              v.height ? `${v.width}×${v.height}` : null,
              formatTimecode(v.durationSec),
              formatBytes(v.sizeBytes),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {v.audioTracks.length > 1 && (
            <p className="mt-1 text-xs text-faint">
              Audio: {v.audioTracks.map((a) => a.title ?? a.language ?? a.codec).join(', ')}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {v.subtitles.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
              >
                {s.label} <span className="text-faint">({s.source})</span>
                {s.source === 'uploaded' && (
                  <button
                    type="button"
                    aria-label={`Delete subtitle ${s.label}`}
                    onClick={() => delSub.mutate(s.id)}
                    className="text-bad hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              aria-label="Subtitle language"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="h-8 w-24 text-xs"
            >
              {[
                'en',
                'hi',
                'es',
                'fr',
                'de',
                'ta',
                'te',
                'ml',
                'bn',
                'mr',
                'ur',
                'ar',
                'ja',
                'ko',
                'zh',
              ].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              onClick={() => {
                setTarget(v.id);
                fileInput.current?.click();
              }}
              disabled={upload.isPending}
            >
              <Upload className="h-3.5 w-3.5" /> Add subtitle
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                confirm(
                  'Remove this file from the database? (The file on disk is not deleted; a rescan will add it again.)',
                ) && delVideo.mutate(v.id)
              }
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove entry
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtworkEditor({
  kind,
  id,
  role,
  url,
  accent,
  title,
}: {
  kind: 'movies' | 'series';
  id: string;
  role: 'poster' | 'backdrop';
  url: string | null;
  accent: string;
  title: string;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState('60');
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin-title'] });
    void qc.invalidateQueries({ queryKey: ['admin-library'] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload(`/api/admin/${kind}/${id}/artwork/${role}`, fd);
    },
    onSuccess: done,
  });
  const frame = useMutation({
    mutationFn: () =>
      api.post(`/api/admin/${kind}/${id}/artwork/${role}/from-video`, { atSec: Number(at) || 0 }),
    onSuccess: done,
  });
  return (
    <div>
      <p className="mb-2 text-sm font-medium capitalize">{role}</p>
      <Artwork
        src={url}
        alt={`${title} ${role}`}
        accent={accent}
        title={title}
        designed={role === 'poster' && !url}
        className={`${role === 'poster' ? 'aspect-[2/3] w-32' : 'aspect-video w-full'} rounded-lg ring-1 ring-line`}
      />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <ImageUp className="h-3.5 w-3.5" /> Upload
        </Button>
        <span className="flex items-center gap-1">
          <Input
            aria-label="Frame time in seconds"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="h-8 w-16 text-xs"
            inputMode="numeric"
          />
          <Button
            size="sm"
            onClick={() => frame.mutate()}
            disabled={frame.isPending}
            title="Grab a frame from the video at this second"
          >
            <Camera className="h-3.5 w-3.5" /> Frame
          </Button>
        </span>
      </div>
      <ErrorText error={upload.error ?? frame.error} />
    </div>
  );
}

function Editor({ item, onClose }: { item: AdminLibraryItem; onClose: () => void }) {
  const qc = useQueryClient();
  const endpoint =
    item.kind === 'movie' ? `/api/admin/movies/${item.id}` : `/api/admin/series/${item.id}`;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-title', item.kind, item.id],
    queryFn: () => api.get<MovieEdit | SeriesEdit>(endpoint),
  });
  const [form, setForm] = useState<Record<string, string | boolean>>({});

  useEffect(() => {
    if (!data) return;
    setForm({
      title: data.title,
      year: data.year?.toString() ?? '',
      overview: data.overview ?? '',
      tagline: data.kind === 'movie' ? (data.tagline ?? '') : '',
      genres: data.genres.join(', '),
      cast: castToText(data.cast ?? []),
      director: data.kind === 'movie' ? (data.director ?? '') : '',
      rating: data.rating?.toString() ?? '',
      contentRating: data.contentRating ?? '',
      featured: data.featured,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const year = Number(form.year);
      const rating = Number(form.rating);
      const body: Record<string, unknown> = {
        title: String(form.title).trim(),
        year: form.year ? (Number.isInteger(year) ? year : null) : null,
        overview: String(form.overview).trim() || null,
        genres: String(form.genres)
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        cast: textToCast(String(form.cast)),
        rating: form.rating ? (Number.isFinite(rating) ? rating : null) : null,
        contentRating: String(form.contentRating).trim() || null,
        featured: !!form.featured,
      };
      if (item.kind === 'movie') {
        body.tagline = String(form.tagline).trim() || null;
        body.director = String(form.director).trim() || null;
      }
      return api.patch(endpoint, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-library'] });
      void refetch();
    },
  });
  const del = useMutation({
    mutationFn: () => api.delete(endpoint),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-library'] });
      onClose();
    },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Drawer open onClose={onClose} title={item.title} wide>
      {isLoading || !data ? (
        <Spinner className="mx-auto mt-10 h-8 w-8" />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <ArtworkEditor
              kind={item.kind === 'movie' ? 'movies' : 'series'}
              id={item.id}
              role="poster"
              url={data.posterUrl}
              accent={data.accent}
              title={data.title}
            />
            <ArtworkEditor
              kind={item.kind === 'movie' ? 'movies' : 'series'}
              id={item.id}
              role="backdrop"
              url={data.backdropUrl}
              accent={data.accent}
              title={data.title}
            />
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <Field label="Title">
                {(id) => (
                  <Input
                    id={id}
                    required
                    value={String(form.title ?? '')}
                    onChange={set('title')}
                  />
                )}
              </Field>
              <Field label="Year">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    value={String(form.year ?? '')}
                    onChange={set('year')}
                  />
                )}
              </Field>
            </div>
            {item.kind === 'movie' && (
              <Field label="Tagline">
                {(id) => (
                  <Input id={id} value={String(form.tagline ?? '')} onChange={set('tagline')} />
                )}
              </Field>
            )}
            <Field label="Description">
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={String(form.overview ?? '')}
                  onChange={set('overview')}
                />
              )}
            </Field>
            <Field label="Genres" hint="Comma separated, e.g. Drama, Sci-Fi">
              {(id) => <Input id={id} value={String(form.genres ?? '')} onChange={set('genres')} />}
            </Field>
            <Field label="Cast" hint="One per line. Optional role: “Asha Verma as Ilse”">
              {(id) => (
                <Textarea id={id} rows={4} value={String(form.cast ?? '')} onChange={set('cast')} />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              {item.kind === 'movie' && (
                <Field label="Director">
                  {(id) => (
                    <Input id={id} value={String(form.director ?? '')} onChange={set('director')} />
                  )}
                </Field>
              )}
              <Field label="Rating (0–10)">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={String(form.rating ?? '')}
                    onChange={set('rating')}
                  />
                )}
              </Field>
              <Field label="Age rating">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="PG-13, U/A 13+"
                    value={String(form.contentRating ?? '')}
                    onChange={set('contentRating')}
                  />
                )}
              </Field>
            </div>
            <Toggle
              checked={!!form.featured}
              onChange={(v) => setForm((f) => ({ ...f, featured: v }))}
              label="Feature in the home hero"
              description="Featured titles rotate in the large banner."
            />
            <ErrorText error={save.error} />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              {save.isSuccess && (
                <span className="text-sm text-ok">Saved. Rescans won’t overwrite your edits.</span>
              )}
            </div>
          </form>

          <section>
            <h3 className="mb-3 font-display font-semibold">Files & subtitles</h3>
            {data.kind === 'movie' ? (
              <VideoFiles videos={data.videos} onChanged={() => void refetch()} />
            ) : (
              <div className="space-y-5">
                {data.seasons.map((s) => (
                  <div key={s.id}>
                    <p className="mb-2 text-sm font-semibold">{s.title ?? `Season ${s.number}`}</p>
                    <div className="space-y-3">
                      {s.episodes.map((e) => (
                        <EpisodeEditor key={e.id} ep={e} onChanged={() => void refetch()} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-bad/30 p-4">
            <h3 className="font-semibold text-bad">Delete database entry</h3>
            <p className="mt-1 text-sm text-muted">
              Removes this title from TaazaStream. Video files on disk are not touched; a rescan
              will add them back.
            </p>
            <Button
              variant="danger"
              className="mt-3"
              onClick={() =>
                confirm(`Remove “${data.title}” from the library database?`) && del.mutate()
              }
            >
              <Trash2 className="h-4 w-4" /> Delete entry
            </Button>
            <ErrorText error={del.error} />
          </section>
        </div>
      )}
    </Drawer>
  );
}

function EpisodeEditor({
  ep,
  onChanged,
}: {
  ep: SeriesEdit['seasons'][number]['episodes'][number];
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(ep.title);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/admin/episodes/${ep.id}`, { title }),
    onSuccess: onChanged,
  });
  return (
    <details className="rounded-xl border border-line bg-ink/60">
      <summary className="cursor-pointer px-3 py-2 text-sm">
        E{ep.number} · {ep.title}
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <div className="flex gap-2">
          <Input
            aria-label="Episode title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            size="md"
            onClick={() => save.mutate()}
            disabled={save.isPending || title === ep.title}
          >
            Save
          </Button>
        </div>
        <VideoFiles videos={ep.videos} onChanged={onChanged} />
      </div>
    </details>
  );
}

export default function LibraryPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'all' | 'movie' | 'series'>('all');
  const [missing, setMissing] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [editing, setEditing] = useState<AdminLibraryItem | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-library', kind, dq, missing],
    queryFn: () =>
      api.get<AdminLibraryItem[]>(
        `/api/admin/library${qs({ kind, q: dq, missing: missing ? '1' : undefined })}`,
      ),
  });
  const purge = useMutation({
    mutationFn: () => api.post<{ removed: number }>('/api/admin/library/remove-missing'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-library'] }),
  });

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Library"
        description="Edit metadata, artwork and subtitles. Your edits are stored locally and survive rescans."
        action={
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              confirm('Remove all entries whose files are missing from disk?') && purge.mutate()
            }
          >
            <AlertTriangle className="h-4 w-4" /> Clean up missing
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-5 w-5 text-faint" />
            <span className="sr-only">Filter by title</span>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title"
              className="pl-10"
            />
          </label>
          <div className="flex gap-1 rounded-lg border border-line p-1" role="tablist">
            {(['all', 'movie', 'series'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-md px-3 py-1.5 text-sm capitalize ${kind === k ? 'bg-white/12 text-white' : 'text-muted'}`}
              >
                {k === 'all' ? 'All' : k === 'movie' ? 'Movies' : 'Series'}
              </button>
            ))}
          </div>
          <Toggle checked={missing} onChange={setMissing} label="Only missing files" />
        </div>
        {purge.data && (
          <p className="mt-3 text-sm text-ok">Removed {purge.data.removed} missing entries.</p>
        )}
      </Card>
      <ErrorText error={error} />
      {isLoading ? (
        <Spinner className="mx-auto h-8 w-8" />
      ) : !data?.length ? (
        <p className="text-sm text-muted">Nothing found.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7">
          {data.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => setEditing(item)}
              className="group text-left"
            >
              <div className="relative">
                <Artwork
                  src={item.posterUrl ?? item.backdropUrl}
                  alt={item.title}
                  title={item.title}
                  designed={!item.posterUrl}
                  accent={item.accent}
                  className="aspect-[2/3] rounded-lg ring-1 ring-line transition group-hover:ring-brand-500/60"
                />
                <span className="absolute top-2 left-2">
                  {item.kind === 'movie' ? (
                    <Badge>
                      <Film className="h-3 w-3" /> Movie
                    </Badge>
                  ) : (
                    <Badge>
                      <Tv className="h-3 w-3" /> {item.episodeCount} ep
                    </Badge>
                  )}
                </span>
                {item.missing && (
                  <span className="absolute top-2 right-2">
                    <Badge tone="bad">missing</Badge>
                  </span>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted">
                {item.year ?? '—'} · {item.genres.slice(0, 2).join(', ') || 'No genre'}
              </p>
            </button>
          ))}
        </div>
      )}
      {editing && <Editor item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
