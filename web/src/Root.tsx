// The app with everything around it: theme, icons, data, the signed-in profile,
// and notifications. main.tsx starts it; tests render it the same way.

import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { IconContext } from '@phosphor-icons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import App from './App';
import './index.css';
import { ProfileProvider, readAppearance } from './profile/ProfileContext';
import { queryClient } from './query-client';
import type { Accent } from '@shared/api';
import { buildTheme, cssVariablesResolver } from './theme/theme';
import './theme/tokens.css';

export function Root() {
  // What this device saved, so the app paints in the right colours before the profile loads
  const [initialAppearance] = useState(readAppearance);
  const [accent, setAccent] = useState<Accent>(initialAppearance.accent);
  const theme = useMemo(() => buildTheme(accent), [accent]);

  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme={initialAppearance.theme}
      cssVariablesResolver={cssVariablesResolver}
    >
      <IconContext.Provider value={{ size: 20, weight: 'regular' }}>
        <QueryClientProvider client={queryClient}>
          <ProfileProvider onAccentChange={setAccent}>
            <Notifications />
            <App />
          </ProfileProvider>
        </QueryClientProvider>
      </IconContext.Provider>
    </MantineProvider>
  );
}
