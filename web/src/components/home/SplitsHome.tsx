import {
  ActionIcon,
  Button,
  Loader,
  Menu,
  SegmentedControl,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { ArrowsLeftRight, CaretDown, Check, Plus, SortAscending, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { rectSortingStrategy } from '@dnd-kit/sortable';
import { countActionableInvites } from '../../api';
import { useIsDesktop, useIsMobile } from '../../hooks/useBreakpoints';
import MobileHome from './MobileHome';
import MobileInvites from './MobileInvites';
import {
  type DesktopSplitSort,
  readDesktopSort,
  saveDesktopSort,
  SPLIT_SORT_LABELS,
  SPLIT_SORTS,
} from './split-sorts';
import { useMySplits } from '../../my-splits/useMySplits';
import { navigate } from '../../hooks/useRoute';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { formatMoney } from '../../utils/money';
import { useOpenNewSplit } from './NewSplitDialog';
import Fab from '../ui/Fab';
import { justDragged, useSortableSplit } from './useSortableSplit';
import { SortableSplits } from './SortableSplits';
import ThemeToggle from '../common/ThemeToggle';
import SplitAvatar from '../common/SplitAvatar';
import UserAvatar from '../common/UserAvatar';
import classes from './SplitsHome.module.css';
import { InstallCard } from '../common/InstallApp';
import type { MyInvite, SplitSummary } from '@shared/api';
import { moveSplit } from '../../my-splits/my-splits';
import { describeInvite, linkedInviteId, useAnswerInvite } from './invite-answers';
import { plural } from '../../utils/text';

const FILTERS = ['all', 'mine', 'shared', 'invites'] as const;
type Filter = (typeof FILTERS)[number];
const isFilter = (value: unknown): value is Filter =>
  (FILTERS as readonly unknown[]).includes(value);

const EMPTY_MESSAGES: Record<Exclude<Filter, 'invites'>, string> = {
  all: 'No splits yet. Start one with New split.',
  mine: "You haven't started any splits yet.",
  shared: 'Nobody has shared a split with you yet.',
};

const INVITE_DAYS = 14;

const sortLabels: Record<DesktopSplitSort, string> = { yours: 'Your order', ...SPLIT_SORT_LABELS };

function Balance({ split }: { split: SplitSummary }) {
  const cents = split.myBalanceCents;
  if (cents == null) return null;
  if (split.totalCents === 0) {
    return (
      <div className={classes.balance}>
        <div className={classes.balanceLabel}>No items yet</div>
      </div>
    );
  }
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
  const highlight = linkedInviteId();
  const { busy, respond } = useAnswerInvite();

  return (
    <div className={`sf-card ${classes.list}`}>
      {invites.map((invite) => {
        const { title, meta } = describeInvite(invite);
        const verb = invite.kind === 'request' ? 'Approve' : 'Accept';
        return (
          <div
            key={invite.id}
            className={classes.inviteRow}
            data-highlight={invite.id === highlight || undefined}
          >
            <div className="min-w-0 flex-1">
              <div className={classes.rowTitle}>{title}</div>
              <div className={classes.rowMeta}>{meta}</div>
            </div>
            {invite.kind === 'sent' ? (
              <Button
                variant="default"
                size={size > 40 ? 'md' : 'sm'}
                disabled={busy != null}
                onClick={() => respond(invite, false)}
              >
                Withdraw
              </Button>
            ) : (
              <>
                <ActionIcon
                  variant="default"
                  size={size}
                  radius="md"
                  aria-label={`Decline ${title}`}
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
                  aria-label={`${verb} ${title}`}
                  title={verb}
                  loading={busy === invite.id}
                  disabled={busy != null && busy !== invite.id}
                  onClick={() => respond(invite, true)}
                >
                  <Check
                    size={16}
                    weight="bold"
                  />
                </ActionIcon>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const openSplit = (id: string) => {
  if (!justDragged()) navigate(`?s=${id}`);
};

/** A split on desktop: a card you can drag into your own order */
function SplitCard({ split }: { split: SplitSummary }) {
  const sortable = useSortableSplit(split.id);
  return (
    <UnstyledButton
      {...sortable}
      className={`sf-card ${classes.splitCard}`}
      onClick={() => openSplit(split.id)}
    >
      <div className={classes.cardTop}>
        <SplitAvatar
          splitId={split.id}
          name={split.name}
          pictureVersion={split.pictureVersion}
          size={40}
        />
        <span className={`${classes.rowTitle} ${classes.cardTitle}`}>{split.name}</span>
        <span className="sf-tag">{roleLabel(split)}</span>
      </div>
      <div className={classes.cardBottom}>
        <div className={classes.rowMeta}>{splitMeta(split)}</div>
        <Balance split={split} />
      </div>
    </UnstyledButton>
  );
}

/** A split on phones: a row; press and hold to drag */
function SplitListRow({ split }: { split: SplitSummary }) {
  const sortable = useSortableSplit(split.id);
  return (
    <UnstyledButton
      {...sortable}
      className={classes.splitRow}
      onClick={() => openSplit(split.id)}
    >
      <SplitAvatar
        splitId={split.id}
        name={split.name}
        pictureVersion={split.pictureVersion}
        size={36}
      />
      <div className="min-w-0 flex-1">
        <div className={classes.rowTitle}>{split.name}</div>
        <div className={classes.rowMeta}>
          {roleLabel(split)} · {splitMeta(split)}
        </div>
      </div>
      <Balance split={split} />
    </UnstyledButton>
  );
}

const SplitsHome = ({ tab }: { tab: string | null }) => {
  const { splits, invites, error } = useMySplits();
  const { profile } = useProfile();
  const openNewSplit = useOpenNewSplit();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const [sort, setSort] = useState<DesktopSplitSort>(readDesktopSort);
  const filter = isFilter(tab) ? tab : 'all';
  const setFilter = (next: string) =>
    navigate(next === 'all' ? '' : `?tab=${next}`, { replace: true });

  const loading = splits == null && error == null;
  // Phones: Splits and Invites are tabs of their own (10a, 10f)
  if (isMobile) return filter === 'invites' ? <MobileInvites /> : <MobileHome />;
  const inviteCount = countActionableInvites(invites);
  const footnote = <p className={classes.footnote}>Invites expire after {INVITE_DAYS} days.</p>;

  // Desktop has its own Invites page, reached from the sidebar
  if (isDesktop && filter === 'invites') {
    return (
      <div className={classes.page}>
        <div>
          <Title order={2}>Invites</Title>
          <p className="sf-muted mt-1">
            Accept to add the split to My splits, and approve people asking to join yours. Invites
            expire after {INVITE_DAYS} days.
          </p>
        </div>
        {loading && <Loader size="sm" />}
        {invites != null && invites.length === 0 && (
          <div className="sf-muted">
            No pending invites. Open a share link from a split to get one.
          </div>
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
          <div className={classes.headerActions}>
            <ThemeToggle size={36} />
            <ActionIcon
              variant="subtle"
              color="gray"
              size={44}
              onClick={() => navigate('?convert')}
              aria-label="Convert currencies"
            >
              <ArrowsLeftRight size={20} />
            </ActionIcon>
            <UnstyledButton
              onClick={() => navigate('?settings')}
              aria-label="Settings"
            >
              <UserAvatar
                preview={false}
                name={profile ? nameFor(profile.email, profile.displayName) : ''}
                email={profile?.email}
                avatarVersion={profile?.avatarVersion}
                previewSrc={profile?.avatarPreview}
                size={32}
              />
            </UnstyledButton>
          </div>
        )}
      </div>

      <div className={classes.filterRow}>
        <SegmentedControl
          className={classes.filter}
          data={filterOptions}
          value={filter}
          onChange={setFilter}
          fullWidth={!isDesktop}
        />
        {isDesktop && filter !== 'invites' && (
          <Menu position="bottom-end">
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                leftSection={<SortAscending size={16} />}
                rightSection={<CaretDown size={12} />}
                aria-label={`Sort: ${sortLabels[sort]}`}
              >
                {sortLabels[sort]}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Sort by</Menu.Label>
              {(Object.keys(sortLabels) as DesktopSplitSort[]).map((key) => (
                <Menu.Item
                  key={key}
                  color={key === sort ? 'accent' : undefined}
                  onClick={() => {
                    setSort(key);
                    saveDesktopSort(key);
                  }}
                >
                  {sortLabels[key]}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </div>

      <InstallCard />

      {error && <div className="sf-negative">{error}</div>}
      {loading && <Loader size="sm" />}

      {filter === 'invites' ? (
        <>
          {invites != null && invites.length === 0 && (
            <div className="sf-muted text-center">
              No pending invites. Open a share link from a split to get one.
            </div>
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
            <SortableSplits
              onMove={moveSplit}
              ids={shown.map((s) => s.id)}
              strategy={rectSortingStrategy}
              layout="grid"
              // Your own order is the one you drag; the others are worked out
              disabled={sort !== 'yours'}
            >
              <div className={classes.grid}>
                {(sort === 'yours' ? shown : [...shown].sort(SPLIT_SORTS[sort])).map((s) => (
                  <SplitCard
                    key={s.id}
                    split={s}
                  />
                ))}
              </div>
            </SortableSplits>
          )}
          {shown != null && shown.length > 0 && !isDesktop && (
            <SortableSplits
              onMove={moveSplit}
              ids={shown.map((s) => s.id)}
            >
              <div className={`sf-card ${classes.list}`}>
                {shown.map((s) => (
                  <SplitListRow
                    key={s.id}
                    split={s}
                  />
                ))}
              </div>
            </SortableSplits>
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
