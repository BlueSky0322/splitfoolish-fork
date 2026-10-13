import { Button, Loader, Tabs, Title } from '@mantine/core';
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { MyInvite, api } from '../api';
import { useIsDesktop } from '../hooks/useBreakpoints';
import { reloadHomeData, useHomeData } from '../hooks/useHomeData';
import { navigate } from '../hooks/useRoute';
import { formatMoney } from '../utils/money';
import { useOpenNewSplit } from './NewSplitDialog';
import Fab from './ui/Fab';

const TABS = ['all', 'mine', 'shared', 'invites'] as const;
type Tab = (typeof TABS)[number];

const EMPTY_MESSAGES: Record<Exclude<Tab, 'invites'>, string> = {
  all: 'No splits yet. Start one with New split.',
  mine: "You haven't created any splits yet.",
  shared: 'Nobody has shared a split with you yet.',
};

const SplitsHome = ({ tab }: { tab: string | null }) => {
  const { splits, invites, error } = useHomeData();
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const activeTab: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'all';
  const openNewSplit = useOpenNewSplit();
  const isDesktop = useIsDesktop();

  const respond = async (invite: MyInvite, accept: boolean) => {
    setBusyInvite(invite.id);
    try {
      if (accept) {
        const { id } = await api.acceptInvite(invite.id);
        reloadHomeData();
        navigate(`?s=${id}`);
        return;
      }
      await api.declineInvite(invite.id);
      await reloadHomeData();
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
      await reloadHomeData();
    } finally {
      setBusyInvite(null);
    }
  };

  const shown =
    splits?.filter(
      (s) =>
        activeTab === 'all' ||
        (activeTab === 'mine' && s.role === 'owner') ||
        (activeTab === 'shared' && s.role !== 'owner'),
    ) ?? null;

  return (
    <div className="p-4 lg:px-10 lg:py-8 max-w-[980px] flex flex-col gap-4 pb-[110px]">
      <div className="flex items-center justify-between gap-2">
        <Title order={2}>My splits</Title>
        {isDesktop && (
          <Button
            leftSection={<Plus size={16} />}
            onClick={openNewSplit}
          >
            New split
          </Button>
        )}
      </div>

      {error && <div className="sf-negative">{error}</div>}

      <Tabs
        value={activeTab}
        onChange={(t) => navigate(t === 'all' ? '' : `?tab=${t}`, { replace: true })}
      >
        <Tabs.List>
          <Tabs.Tab value="all">All</Tabs.Tab>
          <Tabs.Tab value="mine">Mine</Tabs.Tab>
          <Tabs.Tab value="shared">Shared with me</Tabs.Tab>
          <Tabs.Tab
            value="invites"
            rightSection={
              invites?.length ? <span className="sf-count-badge">{invites.length}</span> : null
            }
          >
            Invites
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {splits == null && error == null && <Loader size="sm" />}

      {activeTab === 'invites' ? (
        <>
          {invites?.length === 0 && <div className="sf-muted text-center">No pending invites.</div>}
          <ul className="flex flex-col gap-2">
            {invites?.map((i) => (
              <li
                key={i.id}
                className="sf-card p-4 flex flex-wrap gap-2 justify-between items-center"
              >
                <div>
                  <div className="font-medium">{i.splitName}</div>
                  <div className="text-xs sf-muted">
                    From {i.invitedBy} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="compact-sm"
                    variant="default"
                    disabled={busyInvite != null}
                    onClick={() => respond(i, false)}
                  >
                    Decline
                  </Button>
                  <Button
                    size="compact-sm"
                    disabled={busyInvite != null}
                    onClick={() => respond(i, true)}
                  >
                    Accept
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {shown?.length === 0 && (
            <div className="sf-muted text-center">{EMPTY_MESSAGES[activeTab]}</div>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown?.map((s) => (
              <li key={s.id}>
                <button
                  className="sf-card w-full text-left p-4 hover:shadow-[var(--sf-shadow-md)]"
                  onClick={() => navigate(`?s=${s.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="sf-tag">{s.role === 'owner' ? 'Owner' : 'Shared'}</span>
                  </div>
                  <div className="text-xs sf-muted sf-tabular">
                    {s.peopleCount} {s.peopleCount === 1 ? 'person' : 'people'} ·{' '}
                    {formatMoney(s.totalCents, s.currency)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!isDesktop && (
        <Fab
          label="New split"
          onClick={openNewSplit}
        />
      )}
    </div>
  );
};

export default SplitsHome;
