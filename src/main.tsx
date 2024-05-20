import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { AppContextProvider } from './context/AppContext/AppContext.Provider.tsx';
import { appReducer } from './context/AppContext/app-reducer.ts';
import './index.css';
import { ModalsProvider } from '@mantine/modals';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>Something went wrong</p>}>
      <AppContextProvider
        reducer={appReducer}
        initialState={{ items: [], people: [], owings: [] }}
      >
        <MantineProvider>
          <Notifications />
          <ModalsProvider>
            <App />
          </ModalsProvider>
        </MantineProvider>
      </AppContextProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
