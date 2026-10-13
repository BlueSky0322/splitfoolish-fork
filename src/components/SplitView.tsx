import { ArrowsSplit, CaretLeft, ListBullets, LockSimple, User } from '@phosphor-icons/react';
import { Button, Tabs } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useState } from 'react';
import { SplitActionsContext, useSplit } from '../hooks/useSplit';
import { navigate } from '../hooks/useRoute';
import ErrorBoundary from './ErrorBoundary';
import StateCard from './ui/StateCard';
import ItemList from './ItemList';
import PersonList from './PersonList';
import SplitMembers from './SplitMembers';
import SplitPage from './SplitPage';

interface SplitViewProps {
  splitId: string;
  myEmail: string | null;
}

const SplitView = ({ splitId, myEmail }: SplitViewProps) => {
  const [activeTab, setActiveTab] = useState<string | null>('0');
  const { status, meta, refreshMeta, actions } = useSplit(splitId);

  if (status === 'notfound') {
    return (
      <StateCard
        icon={<LockSimple size={36} />}
        title="This split doesn't exist, or you don't have access"
        body="If someone shared it with you, they may have removed you."
        action={<Button onClick={() => navigate('')}>Go to My splits</Button>}
      />
    );
  }

  const openSharing = () =>
    modals.open({
      title: 'Share',
      children: (
        <SplitMembers
          splitId={splitId}
          myEmail={myEmail!}
          onChange={refreshMeta}
        />
      ),
    });

  return (
    <SplitActionsContext.Provider value={actions}>
      <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-[var(--sf-divider)]">
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<CaretLeft size={18} />}
          onClick={() => navigate('')}
        >
          My Splits
        </Button>
        <div className="font-semibold truncate">{meta?.name}</div>
        <Button
          size="compact-sm"
          variant="light"
          disabled={meta == null || myEmail == null}
          onClick={openSharing}
        >
          Share{meta ? ` (${meta.members.length})` : ''}
        </Button>
      </div>
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
      >
        <Tabs.List>
          <Tabs.Tab
            value="0"
            leftSection={<User size={20} />}
          >
            People
          </Tabs.Tab>
          <Tabs.Tab
            value="1"
            leftSection={<ListBullets size={20} />}
          >
            Items
          </Tabs.Tab>
          <Tabs.Tab
            value="2"
            leftSection={<ArrowsSplit size={20} />}
          >
            Settlements
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel
          value="0"
          className="p-4"
        >
          <ErrorBoundary fallback={<div>An error occured.</div>}>
            <PersonList
              suggestions={[
                ...(meta?.members.map((m) => ({ email: m.email, status: 'member' as const })) ??
                  []),
                ...(meta?.invites?.map((i) => ({ email: i.email, status: 'invited' as const })) ??
                  []),
              ]}
            />
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
      <div className="text-xs text-center sf-muted py-1">
        {status === 'loading' && 'Loading…'}
        {status === 'refreshing' && 'Updating…'}
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && 'Sync failed, changes not saved'}
      </div>
    </SplitActionsContext.Provider>
  );
};

export default SplitView;
