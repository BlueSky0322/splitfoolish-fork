import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { IconContext } from '@phosphor-icons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { AppContextProvider } from './context/AppContext/AppContext.tsx';
import { appReducer } from './context/AppContext/app-reducer.ts';
import './index.css';
import { ProfileProvider, readAppearance } from './profile/ProfileContext.tsx';
import { queryClient } from './query-client.ts';
import { Accent } from './theme/accents.ts';
import { buildTheme, cssVariablesResolver } from './theme/theme.ts';
import './theme/tokens.css';

const initialAppearance = readAppearance();

function Root() {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>Something went wrong</p>}>
      <AppContextProvider
        reducer={appReducer}
        initialState={{ items: [], people: [] }}
      >
        <Root />
      </AppContextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Installable app: the service worker only keeps the built files for offline starts
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
