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
import ErrorBoundary from './components/ui/ErrorBoundary.tsx';
import './index.css';
import { ProfileProvider, readAppearance } from './profile/ProfileContext.tsx';
import { queryClient } from './query-client.ts';
import { Accent } from './theme/accents.ts';
import { buildTheme, cssVariablesResolver } from './theme/theme.ts';
import './theme/tokens.css';
import { trackKeyboardInset } from './keyboard-inset';
import { trackInstall } from './install';
import { restoreLastPage } from './hooks/useRoute';

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

// Back to the page that was open last time, before anything reads the address
restoreLastPage();
// Bottom sheets stay above the on-screen keyboard
trackKeyboardInset();
// The browser's install prompt comes once, early; keep it for the app's own buttons
trackInstall();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>Something went wrong</p>}>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Installable app: the service worker only keeps the built files for offline starts
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
