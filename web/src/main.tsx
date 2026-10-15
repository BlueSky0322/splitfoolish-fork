import React from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ui/ErrorBoundary.tsx';
import { Root } from './Root.tsx';
import { trackKeyboardInset } from './keyboard-inset';
import { trackInstall } from './install';
import { restoreLastPage } from './hooks/useRoute';

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
