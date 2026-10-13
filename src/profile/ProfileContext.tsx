import { useMantineColorScheme } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
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

export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}');
    return {
      theme: ['dark', 'light', 'auto'].includes(saved.theme) ? saved.theme : 'auto',
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

  const apply = useCallback(
    (next: Profile) => {
      const { theme } = next.settings;
      const accent = isAccent(next.settings.accent) ? next.settings.accent : 'blurple';
      setColorScheme(theme);
      onAccentChange(accent);
      saveAppearance({ theme, accent });
    },
    [setColorScheme, onAccentChange],
  );

  const replace = useCallback(
    (next: Profile) => {
      setProfile(next);
      apply(next);
    },
    [apply],
  );

  useEffect(() => {
    api
      .me()
      .then(async (me) => {
        await setCacheUser(me.email);
        replace(me);
      })
      .catch(() => setSignedOut(true));
  }, [replace]);

  const update = useCallback(
    async (patch: ProfilePatch) => {
      if (profile == null) return;
      const before = profile;
      replace({
        ...profile,
        ...('displayName' in patch ? { displayName: patch.displayName ?? null } : {}),
        settings: { ...profile.settings, ...patch.settings },
      });
      try {
        replace(await api.updateMe(patch));
      } catch (err) {
        replace(before);
        notifications.show({
          color: 'red',
          message: err instanceof Error ? err.message : 'Could not save your settings',
        });
      }
    },
    [profile, replace],
  );

  const updateSettings = useCallback(
    (settings: Partial<Settings>) => update({ settings }),
    [update],
  );

  return (
    <ProfileContext.Provider value={{ profile, signedOut, update, updateSettings, replace }}>
      {children}
    </ProfileContext.Provider>
  );
}
