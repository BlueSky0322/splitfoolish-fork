import React from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { Root } from './Root';
import { trackKeyboardInset } from './pwa/keyboard-inset';
import { trackInstall } from './pwa/install';
import { restoreLastPage } from './hooks/useRoute';
import { syncWhenOnline } from './offline/sync';
import { reloadHomeData } from './home/home-data';

// Back to the page that was open last time, before anything reads the address
restoreLastPage();
// What's kept on this device while offline is sent once the connection is back
syncWhenOnline(() => void reloadHomeData());
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
