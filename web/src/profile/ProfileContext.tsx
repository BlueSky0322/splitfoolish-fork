import { useMantineColorScheme } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { Profile } from '../api';
import { ApiError, api } from '../api';
import { queryClient } from '../query-client';
import { isOfflineFailure } from '../offline/outbox';
import { syncAfterSignIn } from '../offline/sync';
import { reloadMySplits } from '../my-splits/my-splits';
import { assumeLastUser, readCache, setCacheUser, writeCache } from '../offline/cache';
import { isAccent } from '../theme/accents';
import {
  DEFAULT_SETTINGS,
  THEMES,
  type Accent,
  type ProfilePatch,
  type Settings,
  type ThemeSetting,
} from '../../../shared/api';
import { showError } from '../utils/notify';
import { quietly } from '../utils/quietly';

// The signed-in user's profile. Theme and accent are also kept in localStorage so
// the app paints in the right colours before /api/me answers.
const APPEARANCE_KEY = 'sf-appearance';

export interface Appearance {
  theme: ThemeSetting;
  accent: Accent;
}

const isTheme = (value: unknown): value is ThemeSetting =>
  (THEMES as readonly unknown[]).includes(value);

export function readAppearance(): Appearance {
  // Whatever was saved, checked field by field
  const saved = quietly(
    () => JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}') as Record<string, unknown>,
  );
  return {
    theme: isTheme(saved?.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
    accent: isAccent(saved?.accent) ? saved.accent : DEFAULT_SETTINGS.accent,
  };
}

// Without storage, the colours just load a moment later next time
const saveAppearance = (appearance: Appearance) =>
  quietly(() => localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)));

interface ProfileContextValue {
  profile: Profile | null;
  signedOut: boolean;
  /** The server couldn't be reached, or failed, before the profile loaded */
  unreachable: boolean;
  /** Asks the server again */
  retry: () => void;
  /**
   * Saves profile fields or settings, showing the change straight away. Rejects if it
   * isn't saved (the change is undone), for the caller to say so.
   */
  update: (patch: ProfilePatch) => Promise<void>;
  /**
   * Shows a change straight away and saves it, as update() does: rejects if it isn't
   * saved (the change is undone); `save` may answer with the saved profile
   */
  change: (
    show: (profile: Profile) => Profile,
    save: () => Promise<Profile | void>,
  ) => Promise<void>;
  /** update() for settings alone */
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
  /**
   * For quick preferences (the theme, how items are shown): shown at once, saved in the
   * background, and a failure explained with a notification
   */
  rememberSettings: (settings: Partial<Settings>) => void;
  /** Replaces the profile with one the server returned */
  replace: (profile: Profile) => void;
  /** Changes the profile on screen from its latest value */
  patch: (change: (profile: Profile) => Profile) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

const ME_KEY = ['me'] as const;
/** Versioned like the other saved copies: one in an older shape is never read */
const ME_CACHE_KEY = 'me-v2';

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
  const { data, error, refetch } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const me = await api.getMe();
        // Cached splits are kept per account; know whose before showing any
        await setCacheUser(me.email);
        fromDevice.current = false;
        syncAfterSignIn(() => void reloadMySplits());
        void writeCache(ME_CACHE_KEY, me);
        return me;
      } catch (err) {
        // No connection: carry on as whoever last used this device, from their saved
        // profile
        if (isOfflineFailure(err) && assumeLastUser() != null) {
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
  // Signing in happens in front of the app (Cloudflare Access), so a 401 means it ran out
  const signedOut = error instanceof ApiError && error.status === 401;
  const unreachable = error != null && !signedOut;
  const retry = useCallback(() => void refetch(), [refetch]);

  // Back online: fetch the real profile if this one came from the device
  useEffect(() => {
    const refresh = () => {
      if (fromDevice.current) void queryClient.invalidateQueries({ queryKey: ME_KEY });
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
  const change = useCallback(
    async (show: (profile: Profile) => Profile, save: () => Promise<Profile | void>) => {
      const current = profileRef.current;
      if (current == null) return;
      const id = ++latest.current;
      replace(show(current));
      try {
        const saved = await save();
        if (saved && id === latest.current) replace(saved);
      } catch (err) {
        if (id === latest.current) replace(current);
        throw err;
      }
    },
    [replace],
  );

  const update = useCallback(
    (patch: ProfilePatch) =>
      change(
        (current) => ({
          ...current,
          ...('displayName' in patch ? { displayName: patch.displayName ?? null } : {}),
          settings: { ...current.settings, ...patch.settings },
        }),
        () => api.updateMe(patch),
      ),
    [change],
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

  const rememberSettings = useCallback(
    (settings: Partial<Settings>) =>
      void update({ settings }).catch((err: unknown) =>
        showError(err, 'Could not save your settings'),
      ),
    [update],
  );

  return (
    <ProfileContext.Provider
      value={{
        profile,
        signedOut,
        unreachable,
        retry,
        change,
        update,
        updateSettings,
        rememberSettings,
        replace,
        patch,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}
