import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Logo } from '../components/Logo';
import { ErrorState, Spinner } from '../components/States';
import { api } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { useConnectInfo, useProfiles } from '../lib/queries';
import { usePrefs } from '../store/prefs';
import type { Profile } from '@taazastream/shared';

const COLORS = [
  '#ff6b35',
  '#ff3d7f',
  '#8b5cf6',
  '#3b82f6',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f43f5e',
];

/** "Who's watching?" — lightweight local profiles (no accounts, no passwords). */
export default function ProfilesPage() {
  useDocumentTitle('Who’s watching?');
  const { data: profiles, isLoading, error, refetch } = useProfiles();
  const setProfile = usePrefs((s) => s.setProfile);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[1]!);

  const create = useMutation({
    mutationFn: () => api.post<Profile>('/api/profiles', { name, color }),
    onSuccess: () => {
      setAdding(false);
      setName('');
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/profiles/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const choose = (p: Profile) => {
    if (manage) return;
    setProfile(p.id);
    qc.clear();
    navigate('/');
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgb(255_107_53/0.16),transparent_70%),radial-gradient(40%_40%_at_80%_100%,rgb(255_61_127/0.12),transparent_70%)]" />
      <div className="absolute top-6 left-6">
        <Logo />
      </div>
      <h1 className="relative font-display text-3xl font-semibold tracking-tight md:text-5xl">
        {manage ? 'Manage profiles' : 'Who’s watching?'}
      </h1>
      {isLoading ? (
        <Spinner className="mt-12 h-10 w-10" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <ul
          className="relative mt-10 flex max-w-4xl flex-wrap justify-center gap-6 md:gap-10"
          data-nav-scope
        >
          {profiles?.map((p, i) => (
            <li key={p.id} className="animate-rise-in" style={{ animationDelay: `${i * 60}ms` }}>
              <button
                type="button"
                onClick={() => choose(p)}
                className="group flex flex-col items-center gap-3 rounded-2xl p-1"
                aria-label={manage ? `Profile ${p.name}` : `Watch as ${p.name}`}
              >
                <span
                  className="relative flex h-24 w-24 items-center justify-center rounded-2xl font-display text-4xl font-bold text-white shadow-xl ring-white transition group-hover:ring-4 group-focus-visible:ring-4 md:h-36 md:w-36 md:text-6xl"
                  style={{ background: `linear-gradient(140deg, ${p.color}, ${p.color}99)` }}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                  {manage && i > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Delete profile ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(
                            `Delete profile “${p.name}”? Their progress and list will be removed.`,
                          )
                        )
                          remove.mutate(p.id);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && remove.mutate(p.id)}
                      className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60"
                    >
                      <Trash2 className="h-8 w-8" />
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted transition group-hover:text-fg md:text-lg">
                  {p.name}
                </span>
              </button>
            </li>
          ))}
          {(profiles?.length ?? 0) < 8 && (
            <li>
              {adding ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (name.trim()) create.mutate();
                  }}
                  className="glass flex w-64 flex-col gap-3 rounded-2xl p-4"
                >
                  <label className="text-xs text-muted" htmlFor="pname">
                    Profile name
                  </label>
                  <input
                    id="pname"
                    autoFocus
                    value={name}
                    maxLength={32}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10 rounded-lg border border-line bg-surface px-3"
                  />
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={c === color}
                        aria-label={c}
                        onClick={() => setColor(c)}
                        className="flex h-7 w-7 items-center justify-center rounded-full"
                        style={{ background: c }}
                      >
                        {c === color && <Check className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                  {create.error && (
                    <p className="text-xs text-bad">{(create.error as Error).message}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={!name.trim() || create.isPending}
                      className="h-9 flex-1 rounded-lg bg-white text-sm font-semibold text-black disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      aria-label="Cancel"
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="group flex flex-col items-center gap-3 p-1"
                  aria-label="Add profile"
                >
                  <span className="flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-dashed border-white/25 text-white/60 transition group-hover:border-white group-hover:text-white md:h-36 md:w-36">
                    <Plus className="h-10 w-10" />
                  </span>
                  <span className="text-sm text-muted md:text-lg">Add profile</span>
                </button>
              )}
            </li>
          )}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setManage((m) => !m)}
        className="relative mt-14 inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-2.5 text-sm tracking-wide text-white/80 uppercase transition hover:border-white hover:text-white"
      >
        {manage ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}{' '}
        {manage ? 'Done' : 'Manage profiles'}
      </button>
    </div>
  );
}

export function ConnectPage() {
  useDocumentTitle('Connect a device');
  const { data, isLoading, error, refetch } = useConnectInfo();
  return (
    <div className="page-x flex min-h-[80svh] items-center pt-24 md:pt-28">
      {isLoading ? (
        <Spinner className="mx-auto h-10 w-10" />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[auto_1fr] md:gap-16">
          <div
            className="mx-auto w-60 rounded-3xl bg-white p-4 shadow-2xl shadow-brand-600/20 md:w-72 [&_svg]:h-auto [&_svg]:w-full"
            role="img"
            aria-label={`QR code for ${data.primaryUrl}`}
            dangerouslySetInnerHTML={{ __html: data.qrSvg }}
          />
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-brand-300 uppercase">
              Connect a device
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold md:text-5xl">
              Watch on your phone, laptop or TV
            </h1>
            <p className="mt-4 text-muted md:text-lg">
              Connect the device to the <strong className="text-fg">same Wi-Fi</strong> as the
              server, then scan the code or type this address in its browser. No app or internet
              required.
            </p>
            <p className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 font-mono text-xl font-semibold break-all text-white md:text-3xl">
              {data.primaryUrl}
            </p>
            {data.urls.length > 1 && (
              <p className="mt-3 text-sm text-muted">
                Other addresses: <span className="font-mono">{data.urls.slice(1).join(' · ')}</span>
              </p>
            )}
            {data.mdnsHost && (
              <p className="mt-2 text-sm text-muted">
                On many devices this also works:{' '}
                <span className="font-mono text-fg">{data.mdnsHost}</span>
              </p>
            )}
            <ul className="mt-6 space-y-1.5 text-sm text-muted">
              <li>• Smart TV: open the TV’s web browser and enter the address above.</li>
              <li>• Add to Home Screen from the browser menu for an app-like experience.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
