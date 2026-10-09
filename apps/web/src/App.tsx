import { lazy, Suspense, useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { EmptyState, Spinner } from './components/States';
import { installSpatialNavigation } from './lib/spatial-nav';
import BrowsePage, { GenrePage, GenresIndexPage } from './pages/Browse';
import { MovieDetailPage, SeriesDetailPage } from './pages/Detail';
import HomePage from './pages/Home';
import ProfilesPage, { ConnectPage } from './pages/Profiles';
import SearchPage, { MyListPage } from './pages/Search';
import { GalleryPage, PdfsPage } from './pages/Shared';
import { useProfiles } from './lib/queries';
import { looksLikeTv, usePrefs } from './store/prefs';

// Heavy, rarely-first routes are split into their own chunks.
const WatchPage = lazy(() => import('./player/Watch'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

function FullscreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink">
      <Spinner />
    </div>
  );
}

/** Ask "Who's watching?" once per device when there is more than one profile. */
function ProfileGate({ children }: { children: React.ReactNode }) {
  const { data: profiles } = useProfiles();
  const { profileId, profileChosen, setProfile } = usePrefs();
  const location = useLocation();

  useEffect(() => {
    if (!profiles?.length) return;
    const exists = profiles.some((p) => p.id === profileId);
    if (!exists && profiles.length === 1) setProfile(profiles[0]!.id);
  }, [profiles, profileId, setProfile]);

  const needsChoice =
    !!profiles &&
    profiles.length > 1 &&
    (!profileChosen || !profiles.some((p) => p.id === profileId));
  if (needsChoice && location.pathname !== '/profiles') return <Navigate to="/profiles" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="pt-28">
      <EmptyState
        title="This page doesn’t exist"
        action={
          <Link to="/" className="rounded-full bg-white px-6 py-2.5 font-semibold text-black">
            Go home
          </Link>
        }
      />
    </div>
  );
}

export default function App() {
  const tvMode = usePrefs((s) => s.tvMode);

  useEffect(() => {
    document.documentElement.classList.toggle('tv', tvMode ?? looksLikeTv());
  }, [tvMode]);

  useEffect(() => installSpatialNavigation(), []);

  return (
    <Suspense fallback={<FullscreenSpinner />}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route
          path="/watch/:videoId"
          element={
            <ProfileGate>
              <WatchPage />
            </ProfileGate>
          }
        />
        <Route
          element={
            <ProfileGate>
              <Layout />
            </ProfileGate>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="movies" element={<BrowsePage kind="movies" />} />
          <Route path="series" element={<BrowsePage kind="series" />} />
          <Route path="browse" element={<GenresIndexPage />} />
          <Route path="genre/:slug" element={<GenrePage />} />
          <Route path="movie/:id" element={<MovieDetailPage />} />
          <Route path="series/:id" element={<SeriesDetailPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="my-list" element={<MyListPage />} />
          <Route path="pdfs" element={<PdfsPage />} />
          <Route path="gallery" element={<GalleryPage />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
