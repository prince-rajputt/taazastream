import type { AuthState } from '@taazastream/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Database,
  FolderOpen,
  Gauge,
  Library,
  LogOut,
  MonitorSmartphone,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/States';
import { api } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import BackupsPage from './Backups';
import DashboardPage from './Dashboard';
import DevicesPage from './Devices';
import FoldersPage from './Folders';
import LibraryPage from './Library';
import SettingsPage from './Settings';
import { Button, ErrorText, Field, Input } from './ui';

export function useAuthState() {
  return useQuery({
    queryKey: ['auth'],
    queryFn: () => api.get<AuthState>('/api/auth/state'),
    staleTime: 30_000,
  });
}

function AuthScreen({ state }: { state: AuthState }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const setup = state.setupRequired;
  const mutation = useMutation({
    mutationFn: () => {
      if (setup && password !== confirm) throw new Error('Passwords do not match');
      return api.post(setup ? '/api/auth/setup' : '/api/auth/login', { username, password });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['auth'] }),
  });

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,rgb(255_107_53/0.16),transparent_70%)]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo />
          <h1 className="font-display text-2xl font-semibold">
            {setup ? 'Create the admin account' : 'Admin sign in'}
          </h1>
          <p className="text-sm text-muted">
            {setup
              ? 'This account manages folders, scanning and settings. Viewers never need an account.'
              : 'Manage your TaazaStream server.'}
          </p>
        </div>
        {setup && !state.setupAllowedFromHere ? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-sm leading-relaxed text-muted">
            <ShieldCheck className="mb-3 h-6 w-6 text-brand-400" />
            For security, the first admin account can only be created{' '}
            <strong className="text-fg">on the server PC itself</strong>. Open
            <span className="mx-1 font-mono text-fg">http://localhost:3000/admin</span>
            in a browser on that computer.
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="space-y-4 rounded-2xl border border-line bg-surface p-6"
          >
            <Field label="Username">
              {(id) => (
                <Input
                  id={id}
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
            <Field label="Password" hint={setup ? 'At least 10 characters.' : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  required
                  minLength={setup ? 10 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            {setup && (
              <Field label="Confirm password">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                )}
              </Field>
            )}
            <ErrorText error={mutation.error} />
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Please wait…' : setup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        )}
        <Link
          to="/"
          className="mt-6 flex items-center justify-center gap-2 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> Back to TaazaStream
        </Link>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/admin/library', label: 'Library', icon: Library },
  { to: '/admin/folders', label: 'Media folders', icon: FolderOpen },
  { to: '/admin/devices', label: 'Devices', icon: MonitorSmartphone },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/backups', label: 'Backup & cloud', icon: Database },
];

export default function AdminApp() {
  useDocumentTitle('Admin');
  const { data: state, isLoading } = useAuthState();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      qc.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin') });
      void qc.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  if (isLoading || !state) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!state.authenticated) return <AuthScreen state={state} />;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 z-30 border-b border-line bg-ink-2/95 backdrop-blur md:h-dvh md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block md:px-5 md:py-6">
          <Link to="/" aria-label="Back to TaazaStream" className="block rounded-lg">
            <Logo />
          </Link>
          <p className="mt-1 hidden text-xs tracking-[0.2em] text-faint uppercase md:block">
            Server admin
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate()}
            className="md:hidden"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <nav
          aria-label="Admin"
          className="flex gap-1 overflow-x-auto px-3 pb-3 scrollbar-none md:flex-col md:px-3"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'}`
              }
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 hidden w-full border-t border-line p-4 md:block">
          <p className="truncate text-xs text-muted">
            Signed in as <span className="text-fg">{state.user?.username}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => logout.mutate()} className="mt-2 -ml-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 md:px-8 md:py-8 lg:px-10">
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="folders" element={<FoldersPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function AdminHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
