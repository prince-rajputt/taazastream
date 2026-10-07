import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-device preferences, stored in localStorage (never sent anywhere except the profile id header). */
interface Prefs {
  profileId: string | null;
  profileChosen: boolean;
  volume: number;
  muted: boolean;
  autoplayNext: boolean;
  subtitleLang: string | null;
  playbackRate: number;
  tvMode: boolean | null;
  setProfile: (id: string) => void;
  clearProfileChoice: () => void;
  set: (p: Partial<Omit<Prefs, 'set' | 'setProfile' | 'clearProfileChoice'>>) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__ts_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    // Private mode / blocked storage: fall back to memory.
    const mem = new Map<string, string>();
    return {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => void mem.set(key, value),
      removeItem: (key: string) => void mem.delete(key),
    };
  }
});

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      profileId: null,
      profileChosen: false,
      volume: 1,
      muted: false,
      autoplayNext: true,
      subtitleLang: null,
      playbackRate: 1,
      tvMode: null,
      setProfile: (id) => set({ profileId: id, profileChosen: true }),
      clearProfileChoice: () => set({ profileChosen: false }),
      set: (p) => set(p),
    }),
    { name: 'taazastream-prefs', storage: safeStorage, version: 1 },
  ),
);

/** Smart TV browsers announce themselves in the user agent. */
export function looksLikeTv(
  ua = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return /smart-?tv|smarttv|tizen|web0s|webos|netcast|bravia|hbbtv|aft[a-z]|crkey|android tv|googletv|vidaa/i.test(
    ua,
  );
}
