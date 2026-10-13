import { ActionIcon, Button, Loader, SegmentedControl, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Check, Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { MyInvite, SplitSummary, api } from '../api';
import { useIsDesktop } from '../hooks/useBreakpoints';
import { reloadHomeData, useHomeData } from '../hooks/useHomeData';
import { navigate } from '../hooks/useRoute';
import { nameFor, useProfile } from '../profile/ProfileContext';
import { formatMoney } from '../utils/money';
import { useOpenNewSplit } from './NewSplitDialog';
import Fab from './ui/Fab';
import UserAvatar from './ui/UserAvatar';
import classes from './SplitsHome.module.css';

const FILTERS = ['all', 'mine', 'shared', 'invites'] as const;
type Filter = (typeof FILTERS)[number];

const EMPTY_MESSAGES: Record<Exclude<Filter, 'invites'>, string> = {
  all: 'No splits yet. Start one with New split.',
  mine: "You haven't started any splits yet.",
  shared: 'Nobody has shared a split with you yet.',
};

const INVITE_DAYS = 14;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Balance({ split }: { split: SplitSummary }) {
  const cents = split.myBalanceCents;
  if (cents == null) return null;
  return (
    <div className={classes.balance}>
      <div className={classes.balanceLabel}>
        {cents > 0 ? "You're owed" : cents < 0 ? 'You owe' : 'All settled'}
      </div>
      <div
        className={`${classes.balanceAmount} ${
          cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : 'sf-muted'
        }`}
      >
        {cents === 0 ? '—' : formatMoney(cents, split.currency)}
      </div>
    </div>
  );
}

const roleLabel = (split: SplitSummary) => (split.role === 'owner' ? 'Owner' : 'Shared');

const splitMeta = (split: SplitSummary) =>
  `${plural(split.peopleCount, 'person', 'people')} · ${formatMoney(
    split.totalCents,
    split.currency,
  )}`;

function InviteList({ invites, size }: { invites: MyInvite[]; size: number }) {
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (invite: MyInvite, accept: boolean) => {
    setBusy(invite.id);
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
      notifications.show({
        color: 'red',
        message: err instanceof Error ? err.message : 'Could not answer the invite',
      });
      await reloadHomeData();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`sf-card ${classes.list}`}>
      {invites.map((invite) => (
        <div
          key={invite.id}
          className={classes.inviteRow}
        >
          <div className="min-w-0 flex-1">
            <div className={classes.rowTitle}>{invite.splitName}</div>
            <div className={classes.rowMeta}>
              From {invite.invitedBy} · expires {new Date(invite.expiresAt).toLocaleDateString()}
            </div>
          </div>
          <ActionIcon
            variant="default"
            size={size}
            radius="md"
            aria-label={`Decline ${invite.splitName}`}
            title="Decline"
            disabled={busy != null}
            onClick={() => respond(invite, false)}
          >
            <X
              size={16}
              weight="bold"
            />
          </ActionIcon>
          <ActionIcon
            size={size}
            radius="md"
            aria-label={`Accept ${invite.splitName}`}
            title="Accept"
            loading={busy === invite.id}
            disabled={busy != null && busy !== invite.id}
            onClick={() => respond(invite, true)}
          >
            <Check
              size={16}
              weight="bold"
            />
          </ActionIcon>
        </div>
      ))}
    </div>
  );
}

const SplitsHome = ({ tab }: { tab: string | null }) => {
  const { splits, invites, error } = useHomeData();
  const { profile } = useProfile();
  const openNewSplit = useOpenNewSplit();
  const isDesktop = useIsDesktop();
  const filter: Filter = FILTERS.includes(tab as Filter) ? (tab as Filter) : 'all';
  const setFilter = (next: string) =>
    navigate(next === 'all' ? '' : `?tab=${next}`, { replace: true });

  const loading = splits == null && error == null;
  const inviteCount = invites?.length ?? 0;
  const footnote = <p className={classes.footnote}>Invites expire after {INVITE_DAYS} days.</p>;

  // Desktop has its own Invites page (F3b), reached from the sidebar
  if (isDesktop && filter === 'invites') {
    return (
      <div className={classes.page}>
        <div>
          <Title order={2}>Invites</Title>
          <p className="sf-muted mt-1">
            Accept to add the split to My splits. Invites expire after {INVITE_DAYS} days.
          </p>
        </div>
        {loading && <Loader size="sm" />}
        {invites != null && invites.length === 0 && (
          <div className="sf-muted">No pending invites.</div>
        )}
        {invites != null && invites.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="sf-label">Pending · {invites.length}</div>
            <InviteList
              invites={invites}
              size={36}
            />
          </div>
        )}
      </div>
    );
  }

  const shown =
    splits?.filter(
      (s) =>
        filter === 'all' ||
        (filter === 'mine' && s.role === 'owner') ||
        (filter === 'shared' && s.role !== 'owner'),
    ) ?? null;

  const filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'mine', label: 'Mine' },
    { value: 'shared', label: isDesktop ? 'Shared with me' : 'Shared' },
    ...(isDesktop
      ? []
      : [
          {
            value: 'invites',
            label: (
              <span className={classes.invitesTab}>
                Invites
                {inviteCount > 0 && <span className="sf-count-badge">{inviteCount}</span>}
              </span>
            ),
          },
        ]),
  ];

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <Title order={isDesktop ? 2 : 3}>My splits</Title>
        {isDesktop ? (
          <Button
            leftSection={<Plus size={16} />}
            onClick={openNewSplit}
          >
            New split
          </Button>
        ) : (
          <UnstyledButton
            onClick={() => navigate('?settings')}
            aria-label="Settings"
          >
            <UserAvatar
              name={profile ? nameFor(profile.email, profile.displayName) : ''}
              email={profile?.email}
              avatarVersion={profile?.avatarVersion}
              size={32}
            />
          </UnstyledButton>
        )}
      </div>

      <SegmentedControl
        className={classes.filter}
        data={filterOptions}
        value={filter}
        onChange={setFilter}
        fullWidth={!isDesktop}
      />

      {error && <div className="sf-negative">{error}</div>}
      {loading && <Loader size="sm" />}

      {filter === 'invites' ? (
        <>
          {invites != null && invites.length === 0 && (
            <div className="sf-muted text-center">No pending invites.</div>
          )}
          {invites != null && invites.length > 0 && (
            <InviteList
              invites={invites}
              size={44}
            />
          )}
          {footnote}
        </>
      ) : (
        <>
          {shown?.length === 0 && (
            <div className={classes.empty}>
              <div className="sf-muted">{EMPTY_MESSAGES[filter]}</div>
            </div>
          )}
          {shown != null && shown.length > 0 && isDesktop && (
            <div className={classes.grid}>
              {shown.map((s) => (
                <UnstyledButton
                  key={s.id}
                  className={`sf-card ${classes.splitCard}`}
                  onClick={() => navigate(`?s=${s.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={classes.rowTitle}>{s.name}</span>
                      <span className="sf-tag">{roleLabel(s)}</span>
                    </div>
                    <div className={classes.rowMeta}>{splitMeta(s)}</div>
                  </div>
                  <Balance split={s} />
                </UnstyledButton>
              ))}
            </div>
          )}
          {shown != null && shown.length > 0 && !isDesktop && (
            <div className={`sf-card ${classes.list}`}>
              {shown.map((s) => (
                <UnstyledButton
                  key={s.id}
                  className={classes.splitRow}
                  onClick={() => navigate(`?s=${s.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className={classes.rowTitle}>{s.name}</div>
                    <div className={classes.rowMeta}>
                      {roleLabel(s)} · {splitMeta(s)}
                    </div>
                  </div>
                  <Balance split={s} />
                </UnstyledButton>
              ))}
            </div>
          )}
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
