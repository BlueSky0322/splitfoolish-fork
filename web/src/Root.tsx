// The app with everything around it: theme, icons, data, the signed-in profile,
// notifications and modals. main.tsx starts it; tests render it the same way.

import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { IconContext } from '@phosphor-icons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import App from './App.tsx';
import './index.css';
import { ProfileProvider, readAppearance } from './profile/ProfileContext.tsx';
import { queryClient } from './query-client.ts';
import { Accent } from './theme/accents.ts';
import { buildTheme, cssVariablesResolver } from './theme/theme.ts';
import './theme/tokens.css';

const initialAppearance = readAppearance();

export function Root() {
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
            <ModalsProvider>
              <App />
            </ModalsProvider>
          </ProfileProvider>
        </QueryClientProvider>
      </IconContext.Provider>
    </MantineProvider>
  );
}
