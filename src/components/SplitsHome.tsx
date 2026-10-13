import { Badge, Button, Loader, Tabs, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MyInvite, SplitSummary, api } from '../api';
import { navigate } from '../hooks/useRoute';
import { readCache, writeCache } from '../split-cache';

interface HomeData {
  splits: SplitSummary[];
  invites: MyInvite[];
}

const TABS = ['all', 'mine', 'shared', 'invites'] as const;
type Tab = (typeof TABS)[number];

const EMPTY_MESSAGES: Record<Exclude<Tab, 'invites'>, string> = {
  all: 'No splits yet. Create one above.',
  mine: "You haven't created any splits yet.",
  shared: 'Nobody has shared a split with you yet.',
};

const SplitsHome = ({ tab }: { tab: string | null }) => {
  const [splits, setSplits] = useState<SplitSummary[] | null>(null);
  const [invites, setInvites] = useState<MyInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const activeTab: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'all';
  const newSplitForm = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '' },
    validate: { name: (value) => (value.trim() ? null : 'Give the split a name') },
  });

  const freshLoaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const [{ splits }, { invites }] = await Promise.all([api.listSplits(), api.myInvites()]);
      freshLoaded.current = true;
      setSplits(splits);
      setInvites(invites);
      writeCache<HomeData>('home', { splits, invites });
    } catch {
      setError('Could not load your splits.');
    }
  }, []);

  useEffect(() => {
    // Show the last-seen list straight away, unless the fresh one already arrived
    readCache<HomeData>('home').then((cached) => {
      if (cached == null || freshLoaded.current) return;
      setSplits(cached.splits);
      setInvites(cached.invites);
    });
    load();
  }, [load]);

  const handleCreate = async ({ name }: { name: string }) => {
    try {
      const { id } = await api.createSplit(name.trim());
      navigate(`?s=${id}`);
    } catch {
      setError('Could not create the split.');
    }
  };

  const respond = async (invite: MyInvite, accept: boolean) => {
    setBusyInvite(invite.id);
    try {
      if (accept) {
        const { id } = await api.acceptInvite(invite.id);
        navigate(`?s=${id}`);
        return;
      }
      await api.declineInvite(invite.id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
      await load();
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
    <div className="p-4">
      <Title
        order={2}
        className="mb-4 text-gray-800"
      >
        My Splits
      </Title>

      <form
        onSubmit={newSplitForm.onSubmit(handleCreate)}
        className="flex gap-2 items-start mb-4"
      >
        <TextInput
          className="flex-1"
          key={newSplitForm.key('name')}
          {...newSplitForm.getInputProps('name')}
          placeholder="Friday dinner"
          aria-label="New split name"
        />
        <Button type="submit">New Split</Button>
      </form>

      {error && <div className="text-red-600 mb-4">{error}</div>}

      <Tabs
        value={activeTab}
        onChange={(t) => navigate(t === 'all' ? '' : `?tab=${t}`, { replace: true })}
        className="mb-4"
      >
        <Tabs.List>
          <Tabs.Tab value="all">All</Tabs.Tab>
          <Tabs.Tab value="mine">Mine</Tabs.Tab>
          <Tabs.Tab value="shared">Shared with me</Tabs.Tab>
          <Tabs.Tab
            value="invites"
            rightSection={
              invites?.length ? (
                <Badge
                  size="sm"
                  circle
                >
                  {invites.length}
                </Badge>
              ) : null
            }
          >
            Invites
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {splits == null && error == null && <Loader size="sm" />}

      {activeTab === 'invites' ? (
        <>
          {invites?.length === 0 && (
            <div className="text-gray-400 text-center">No pending invites.</div>
          )}
          <ul className="flex flex-col gap-2">
            {invites?.map((i) => (
              <li
                key={i.id}
                className="border rounded p-3 flex flex-wrap gap-2 justify-between items-center"
              >
                <div>
                  <div className="font-semibold">{i.splitName}</div>
                  <div className="text-xs text-gray-500">
                    From {i.invitedBy} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="compact-sm"
                    disabled={busyInvite != null}
                    onClick={() => respond(i, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    disabled={busyInvite != null}
                    onClick={() => respond(i, false)}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {shown?.length === 0 && (
            <div className="text-gray-400 text-center">{EMPTY_MESSAGES[activeTab]}</div>
          )}
          <ul className="flex flex-col gap-2">
            {shown?.map((s) => (
              <li key={s.id}>
                <button
                  className="w-full text-left border rounded p-3 hover:bg-gray-50"
                  onClick={() => navigate(`?s=${s.id}`)}
                >
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-gray-500">
                    {s.role === 'owner' ? 'Owner' : 'Shared with you'} · {s.memberCount}{' '}
                    {s.memberCount === 1 ? 'person' : 'people'} · updated{' '}
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default SplitsHome;
