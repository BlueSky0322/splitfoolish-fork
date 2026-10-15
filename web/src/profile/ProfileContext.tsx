import { useMantineColorScheme } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { Profile, api } from '../api';
import { queryClient } from '../query-client';
import { isOffline } from '../offline/outbox';
import { flushOfflineChanges } from '../offline/pending-creates';
import { assumeLastUser, readCache, setCacheUser, writeCache } from '../offline/cache';
import { Accent, isAccent } from '../theme/accents';
import {
  DEFAULT_SETTINGS,
  type ProfilePatch,
  type Settings,
  type ThemeSetting,
} from '../../../shared/api';
import { reloadHomeData } from '../home-data';
import { showError } from '../utils/notify';

// The signed-in user's profile. Theme and accent are also kept in localStorage so
// the app paints in the right colours before /api/me answers.
const APPEARANCE_KEY = 'sf-appearance';

export interface Appearance {
  theme: ThemeSetting;
  accent: Accent;
}

const isTheme = (value: unknown): value is ThemeSetting =>
  value === 'dark' || value === 'light' || value === 'auto';

export function readAppearance(): Appearance {
  try {
    // Whatever was saved, checked field by field
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}') as {
      theme?: unknown;
      accent?: unknown;
    };
    return {
      theme: isTheme(saved.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
      accent: isAccent(saved.accent) ? saved.accent : DEFAULT_SETTINGS.accent,
    };
  } catch {
    return { theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent };
  }
}

function saveAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // Private mode: the colours just load a moment later next time
  }
}

interface ProfileContextValue {
  profile: Profile | null;
  signedOut: boolean;
  /** Saves profile fields or settings, showing the change straight away */
  update: (patch: ProfilePatch) => Promise<void>;
  /** Saves some settings, showing the change straight away */
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
  /** Replaces the profile with one the server returned */
  replace: (profile: Profile) => void;
  /** Changes the profile on screen from its latest value */
  patch: (change: (profile: Profile) => Profile) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

const ME_KEY = ['me'] as const;
const ME_CACHE_KEY = 'me';

export const useProfile = () => {
  const value = useContext(ProfileContext);
  if (value == null) throw new Error('useProfile needs a ProfileProvider');
  return value;
};

/** The name to show for someone: their display name, else the part of the email before @ */
export const nameFor = (email: string, displayName?: string | null) =>
  displayName?.trim() || email.split('@')[0];

export function ProfileProvider({
  children,
  onAccentChange,
}: {
  children: ReactNode;
  onAccentChange: (accent: Accent) => void;
}) {
  const fromDevice = useRef(false);
  // Loaded once: after that, this device's changes are the latest, and a refetch
  // landing mid-change would undo one
  const { data, isError: signedOut } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const me = await api.me();
        // Cached splits are kept per account; know whose before showing any
        await setCacheUser(me.email);
        fromDevice.current = false;
        // Splits made and changes kept on this device before it was last closed
        void flushOfflineChanges().then((sent) => (sent > 0 ? reloadHomeData() : undefined));
        void writeCache(ME_CACHE_KEY, me);
        return me;
      } catch (err) {
        // Offline: carry on as whoever last used this device, from their saved profile.
        // Online, a failure means signing in again (Cloudflare Access).
        if (isOffline() && assumeLastUser() != null) {
          const saved = await readCache<Profile>(ME_CACHE_KEY);
          if (saved) {
            fromDevice.current = true;
            return saved;
          }
        }
        throw err;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    // Runs offline too, so the saved profile is used rather than waiting for a connection
    networkMode: 'always',
  });
  const profile = data ?? null;

  // Back online: send what was kept on this device, and fetch the real profile if this
  // one came from the device
  useEffect(() => {
    const refresh = () => {
      if (fromDevice.current) void queryClient.invalidateQueries({ queryKey: ME_KEY });
      void flushOfflineChanges().then(() => reloadHomeData());
    };
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);
  const { setColorScheme } = useMantineColorScheme();

  // Only touch the colour scheme and accent when they change: re-applying them on every
  // settings change (say, collapsing the sidebar) restyles the whole page
  const applied = useRef<{ theme: ThemeSetting; accent: Accent } | null>(null);
  const apply = useCallback(
    (next: Profile) => {
      const { theme, accent } = next.settings;
      if (applied.current?.theme === theme && applied.current?.accent === accent) return;
      if (applied.current?.theme !== theme) setColorScheme(theme);
      if (applied.current?.accent !== accent) onAccentChange(accent);
      applied.current = { theme, accent };
      saveAppearance({ theme, accent });
    },
    [setColorScheme, onAccentChange],
  );

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const replace = useCallback((next: Profile) => {
    profileRef.current = next;
    queryClient.setQueryData(ME_KEY, next);
  }, []);

  // Theme and accent follow the profile, however it changed
  useEffect(() => {
    if (profile != null) apply(profile);
  }, [profile, apply]);

  // Each change shows straight away. The server's reply only replaces what's on screen
  // if no newer change has been made since, so quick changes never jump back.
  const latest = useRef(0);
  const update = useCallback(
    async (patch: ProfilePatch) => {
      const current = profileRef.current;
      if (current == null) return;
      const id = ++latest.current;
      replace({
        ...current,
        ...('displayName' in patch ? { displayName: patch.displayName ?? null } : {}),
        settings: { ...current.settings, ...patch.settings },
      });
      try {
        const saved = await api.updateMe(patch);
        if (id === latest.current) replace(saved);
      } catch (err) {
        if (id === latest.current) replace(current);
        showError(err, 'Could not save your settings');
      }
    },
    [replace],
  );

  const patch = useCallback(
    (change: (profile: Profile) => Profile) => {
      if (profileRef.current != null) replace(change(profileRef.current));
    },
    [replace],
  );

  const updateSettings = useCallback(
    (settings: Partial<Settings>) => update({ settings }),
    [update],
  );

  return (
    <ProfileContext.Provider value={{ profile, signedOut, update, updateSettings, replace, patch }}>
      {children}
    </ProfileContext.Provider>
  );
}
