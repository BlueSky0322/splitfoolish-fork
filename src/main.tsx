import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { AppContextProvider } from './context/AppContext/AppContext.tsx';
import { appReducer } from './context/AppContext/app-reducer.ts';
import './index.css';
import { IDBContextProvider } from './context/IDBContext/IDBContext.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>Something went wrong</p>}>
      <IDBContextProvider
        dbName="splitfoolish"
        schema={{
          people: { keyPath: 'id', autoIncrement: true },
          items: {
            keyPath: 'id',
            autoIncrement: true,
          },
        }}
        indexes={{
          people: [{ keyPath: 'name', name: 'name', options: { unique: false } }],
          items: [
            { keyPath: 'name', name: 'name', options: { unique: false } },
            { keyPath: 'cost', name: 'cost', options: { unique: false } },
          ],
        }}
      >
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
      </IDBContextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
