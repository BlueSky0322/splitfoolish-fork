import { useMantineColorScheme } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Profile, ProfilePatch, Settings, ThemeSetting, api } from '../api';
import { setCacheUser } from '../split-cache';
import { Accent, isAccent } from '../theme/accents';

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
      theme: isTheme(saved.theme) ? saved.theme : 'auto',
      accent: isAccent(saved.accent) ? saved.accent : 'blurple',
    };
  } catch {
    return { theme: 'auto', accent: 'blurple' };
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const { setColorScheme } = useMantineColorScheme();

  // Only touch the colour scheme and accent when they change: re-applying them on every
  // settings change (say, collapsing the sidebar) restyles the whole page
  const applied = useRef<{ theme: ThemeSetting; accent: Accent } | null>(null);
  const apply = useCallback(
    (next: Profile) => {
      const { theme } = next.settings;
      const accent = isAccent(next.settings.accent) ? next.settings.accent : 'blurple';
      if (applied.current?.theme === theme && applied.current?.accent === accent) return;
      if (applied.current?.theme !== theme) setColorScheme(theme);
      if (applied.current?.accent !== accent) onAccentChange(accent);
      applied.current = { theme, accent };
      saveAppearance({ theme, accent });
    },
    [setColorScheme, onAccentChange],
  );

  const profileRef = useRef(profile);
  const replace = useCallback(
    (next: Profile) => {
      profileRef.current = next;
      setProfile(next);
      apply(next);
    },
    [apply],
  );

  // Load once. (Depending on replace would refetch on every change, because the colour
  // scheme setter it uses is a new function each render, and the stale reply would
  // undo the change that was just made.)
  const replaceRef = useRef(replace);
  replaceRef.current = replace;
  useEffect(() => {
    api
      .me()
      .then(async (me) => {
        await setCacheUser(me.email);
        replaceRef.current(me);
      })
      .catch(() => setSignedOut(true));
  }, []);

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
        notifications.show({
          color: 'red',
          message: err instanceof Error ? err.message : 'Could not save your settings',
        });
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
