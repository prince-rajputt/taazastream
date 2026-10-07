import { useQuery } from '@tanstack/react-query';
import {
  Bookmark,
  Clapperboard,
  Home,
  LayoutGrid,
  QrCode,
  Search,
  Settings2,
  Tv,
  Users,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../lib/api';
import { useScrolled } from '../lib/hooks';
import { useProfiles } from '../lib/queries';
import { usePrefs } from '../store/prefs';
import { Logo } from './Logo';
import { SearchBox } from './SearchBox';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/movies', label: 'Movies', icon: Clapperboard },
  { to: '/series', label: 'Series', icon: Tv },
  { to: '/my-list', label: 'My List', icon: Bookmark },
];

function ProfileMenu() {
  const { data: profiles } = useProfiles();
  const profileId = usePrefs((s) => s.profileId);
  const clear = usePrefs((s) => s.clearProfileChoice);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = profiles?.find((p) => p.id === profileId) ?? profiles?.[0];

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profile: ${current?.name ?? 'Home'}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg font-display text-sm font-bold text-white shadow-lg ring-1 ring-white/15 md:h-10 md:w-10"
        style={{ background: current?.color ?? '#ff6b35' }}
      >
        {(current?.name ?? 'H').slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div
          role="menu"
          className="glass absolute top-12 right-0 z-50 w-56 overflow-hidden rounded-2xl py-1.5 shadow-2xl shadow-black/60 animate-fade-in"
        >
          <p className="px-4 pt-1.5 pb-2 text-xs text-muted">
            Watching as <span className="font-semibold text-fg">{current?.name}</span>
          </p>
          {[
            { to: '/profiles', label: 'Switch profile', icon: Users, onClick: clear },
            { to: '/connect', label: 'Connect a device', icon: QrCode },
            { to: '/admin', label: 'Admin dashboard', icon: Settings2 },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick?.();
              }}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-white/10"
            >
              <item.icon className="h-4 w-4 text-muted" /> {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Polls the local server; shows a banner when this device loses the LAN connection. */
function ServerStatus() {
  const { isError, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string }>('/api/health'),
    refetchInterval: (q) => (q.state.status === 'error' ? 5_000 : 30_000),
    retry: 1,
    refetchOnWindowFocus: true,
  });
  if (!isError) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-bad/95 px-4 py-2 text-sm font-medium text-white"
    >
      <WifiOff className="h-4 w-4" /> Can’t reach the TaazaStream server — check your Wi-Fi.
      <button
        type="button"
        onClick={() => void refetch()}
        className="rounded-full bg-white/20 px-3 py-0.5 hover:bg-white/30"
      >
        Retry
      </button>
    </div>
  );
}

export function Layout() {
  const scrolled = useScrolled();
  const location = useLocation();
  const [mobileSearch, setMobileSearch] = useState(false);
  const transparentTop = location.pathname === '/' || /^\/(movie|series)\//.test(location.pathname);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMobileSearch(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only z-[70] rounded bg-white px-3 py-2 text-black focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <ServerStatus />
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          scrolled || !transparentTop
            ? 'border-b border-line bg-ink/85 backdrop-blur-xl'
            : 'bg-gradient-to-b from-black/70 to-transparent'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="page-x flex h-16 items-center gap-4 md:h-[4.5rem] md:gap-8">
          <Link to="/" className="shrink-0 rounded-lg" aria-label="TaazaStream home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:text-white'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <div className="hidden w-64 md:block lg:w-80">
              <SearchBox key={location.pathname} />
            </div>
            <button
              type="button"
              aria-label="Search"
              onClick={() => setMobileSearch((s) => !s)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 hover:bg-white/10 md:hidden"
            >
              <Search className="h-5 w-5" />
            </button>
            <ProfileMenu />
          </div>
        </div>
        {mobileSearch && (
          <div className="page-x pb-3 md:hidden">
            <SearchBox autoFocus onDone={() => setMobileSearch(false)} />
          </div>
        )}
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>

      <footer className="page-x mt-16 hidden border-t border-line py-8 text-xs text-faint md:block">
        <div className="flex items-center justify-between gap-4">
          <span>TaazaStream · streaming from your own server. No internet required.</span>
          <Link to="/connect" className="hover:text-fg">
            Connect another device
          </Link>
        </div>
      </footer>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/92 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid h-[4.25rem] grid-cols-5">
          {[...NAV, { to: '/browse', label: 'Genres', icon: LayoutGrid }].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n ? n.end : false}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 text-[0.68rem] font-medium ${isActive ? 'text-white' : 'text-white/55'}`
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon className={`h-5 w-5 ${isActive ? 'text-brand-400' : ''}`} />
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
