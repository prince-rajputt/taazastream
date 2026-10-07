import type {
  ContinueWatchingItem,
  GenreInfo,
  HomeFeed,
  MovieDetail,
  Paged,
  Profile,
  SearchResult,
  SearchSuggestion,
  SeriesDetail,
  TitleCard,
} from '@taazastream/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePrefs } from '../store/prefs';
import { api, qs } from './api';

/** Query keys include the profile so switching profiles never shows stale progress/lists. */
function useProfileKey() {
  return usePrefs((s) => s.profileId ?? 'default');
}

export function useHome() {
  const p = useProfileKey();
  return useQuery({ queryKey: ['home', p], queryFn: () => api.get<HomeFeed>('/api/home') });
}

export function useBrowse(kind: 'movies' | 'series', params: { genre?: string; sort?: string; page?: number }) {
  const p = useProfileKey();
  return useQuery({
    queryKey: ['browse', kind, params, p],
    queryFn: () => api.get<Paged<TitleCard>>(`/api/${kind}${qs({ ...params, pageSize: 60 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useGenre(slug: string) {
  const p = useProfileKey();
  return useQuery({
    queryKey: ['genre', slug, p],
    queryFn: () => api.get<{ genre: GenreInfo; items: TitleCard[] }>(`/api/genres/${encodeURIComponent(slug)}`),
  });
}

export function useGenres() {
  return useQuery({ queryKey: ['genres'], queryFn: () => api.get<GenreInfo[]>('/api/genres'), staleTime: 5 * 60_000 });
}

export function useMovie(id: string) {
  const p = useProfileKey();
  return useQuery({ queryKey: ['movie', id, p], queryFn: () => api.get<MovieDetail>(`/api/movies/${id}`) });
}

export function useSeries(id: string) {
  const p = useProfileKey();
  return useQuery({ queryKey: ['series', id, p], queryFn: () => api.get<SeriesDetail>(`/api/series/${id}`) });
}

export function useSearch(q: string) {
  const p = useProfileKey();
  return useQuery({
    queryKey: ['search', q, p],
    queryFn: () => api.get<SearchResult>(`/api/search${qs({ q })}`),
    placeholderData: keepPreviousData,
  });
}

export function useSuggestions(q: string) {
  return useQuery({
    queryKey: ['suggest', q],
    queryFn: () => api.get<SearchSuggestion[]>(`/api/search/suggest${qs({ q })}`),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useMyList() {
  const p = useProfileKey();
  return useQuery({ queryKey: ['my-list', p], queryFn: () => api.get<TitleCard[]>('/api/my-list') });
}

export function useContinueWatching() {
  const p = useProfileKey();
  return useQuery({ queryKey: ['continue', p], queryFn: () => api.get<ContinueWatchingItem[]>('/api/continue-watching') });
}

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: () => api.get<Profile[]>('/api/profiles') });
}

export function useConnectInfo() {
  return useQuery({
    queryKey: ['connect'],
    queryFn: () => api.get<{ name: string; primaryUrl: string; urls: string[]; mdnsHost: string | null; qrSvg: string }>('/api/connect'),
    staleTime: 60_000,
  });
}

/** Add/remove from My List with an optimistic update across cached views. */
export function useToggleMyList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id, add }: { kind: 'movie' | 'series'; id: string; add: boolean }) =>
      add ? api.post('/api/my-list', { kind, id }) : api.delete(`/api/my-list/${kind}/${id}`),
    onMutate: async ({ id, add }) => {
      const patch = (old: unknown): unknown => {
        if (!old || typeof old !== 'object') return old;
        if (Array.isArray(old)) return old.map(patch);
        const o = old as Record<string, unknown>;
        const next: Record<string, unknown> = { ...o };
        if (o.id === id && 'inMyList' in o) next.inMyList = add;
        for (const k of ['hero', 'rows', 'items', 'related']) if (Array.isArray(o[k])) next[k] = (o[k] as unknown[]).map(patch);
        return next;
      };
      for (const key of [['home'], ['movie'], ['series'], ['browse'], ['search'], ['genre']]) {
        qc.setQueriesData({ queryKey: key }, patch);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['my-list'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
}

export function useRemoveContinue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) => api.delete(`/api/continue-watching/${videoId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['continue'] });
    },
  });
}
