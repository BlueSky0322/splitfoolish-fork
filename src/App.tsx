import { Button, Tabs } from '@mantine/core';
import { IconArrowsSplit, IconListDetails, IconUser } from '@tabler/icons-react';
import { useContext, useEffect, useState } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import ItemList from './components/ItemList';
import PersonList from './components/PersonList';
import SplitPage from './components/SplitPage';
import { AppContext } from './context/AppContext/AppContext';

function App() {
  const { dispatch } = useContext(AppContext);
  const [activeTab, setActiveTab] = useState<string | null>('0');

  useEffect(() => {
    dispatch({ type: 'LOAD_FROM_LOCALSTORAGE', payload: null });
    dispatch({ type: 'SETTLE', payload: null });
  }, []);

  return (
    <div className="max-w-screen-md m-auto bg-white min-h-screen">
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
      >
        <Tabs.List>
          <Tabs.Tab
            value="0"
            leftSection={<IconUser />}
          >
            People
          </Tabs.Tab>
          <Tabs.Tab
            value="1"
            leftSection={<IconListDetails />}
          >
            Items
          </Tabs.Tab>
          <Tabs.Tab
            value="2"
            leftSection={<IconArrowsSplit />}
          >
            Split
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel
          value="0"
          className="p-4"
        >
          <ErrorBoundary fallback={<div>An error occured.</div>}>
            <PersonList />
          </ErrorBoundary>
        </Tabs.Panel>
        <Tabs.Panel
          value="1"
          className="p-4"
        >
          <ErrorBoundary fallback={<div>An error occured.</div>}>
            <ItemList />
          </ErrorBoundary>
        </Tabs.Panel>
        <Tabs.Panel
          value="2"
          className="p-4"
        >
          <ErrorBoundary fallback={<div>An error occured.</div>}>
            <SplitPage />
          </ErrorBoundary>
        </Tabs.Panel>
      </Tabs>
      <div className="flex gap-2 items-center justify-center">
        <div className="text-xs">Are you testing?</div>
        <Button
          className="p-0"
          size="compact-xs"
          radius="xs"
          variant="transparent"
          onClick={() => {
            dispatch({ type: 'LOAD_TEST_DATA', payload: null });
          }}
        >
          Load test data.
        </Button>
      </div>
    </div>
  );
}

export default App;
