import { ActionIcon, Button, Tooltip, UnstyledButton } from '@mantine/core';
import {
  ArrowsLeftRight,
  ArrowsSplit,
  CaretRight,
  EnvelopeSimple,
  GearSix,
  Plus,
  SidebarSimple,
  Stack,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { countActionableInvites } from '../../api';
import { useMySplits } from '../../my-splits/useMySplits';
import type { Route } from '../../hooks/useRoute';
import { navigate } from '../../hooks/useRoute';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { useOpenNewSplit } from '../home/NewSplitDialog';
import BalanceTag from './BalanceTag';
import SplitAvatar from '../common/SplitAvatar';
import ThemeToggle from '../common/ThemeToggle';
import { justDragged, useSortableSplit } from '../home/useSortableSplit';
import { SortableSplits } from '../home/SortableSplits';
import UserAvatar from '../common/UserAvatar';
import classes from './Sidebar.module.css';
import type { SplitSummary } from '@shared/api';
import { moveSplit } from '../../my-splits/my-splits';

interface SidebarProps {
  route: Route;
  open: boolean;
  onToggle: () => void;
}

const NavItem = ({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) => (
  <UnstyledButton
    className={classes.navItem}
    data-active={active || undefined}
    aria-current={active ? 'page' : undefined}
    onClick={onClick}
  >
    {icon}
    <span className="flex-1">{label}</span>
    {badge ? <span className="sf-count-badge">{badge}</span> : null}
  </UnstyledButton>
);

const openSplit = (id: string) => {
  if (!justDragged()) navigate(`?s=${id}`);
};

/** A split in the open sidebar: drag to reorder, click to open */
function SplitRow({ split, active }: { split: SplitSummary; active: boolean }) {
  const sortable = useSortableSplit(split.id);
  return (
    <UnstyledButton
      {...sortable}
      className={classes.splitRow}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => openSplit(split.id)}
    >
      <SplitAvatar
        splitId={split.id}
        name={split.name}
        pictureVersion={split.pictureVersion}
        size={22}
        active={active}
      />
      <span className={classes.splitName}>{split.name}</span>
      <BalanceTag
        cents={split.myBalanceCents}
        currency={split.currency}
        hasItems={split.totalCents > 0}
      />
    </UnstyledButton>
  );
}

/** A split in the collapsed sidebar */
function RailTile({ split, active }: { split: SplitSummary; active: boolean }) {
  const sortable = useSortableSplit(split.id);
  return (
    <Tooltip
      label={split.name}
      position="right"
    >
      <UnstyledButton
        {...sortable}
        className={classes.railTile}
        data-active={active || undefined}
        onClick={() => openSplit(split.id)}
        aria-label={split.name}
      >
        <SplitAvatar
          splitId={split.id}
          name={split.name}
          pictureVersion={split.pictureVersion}
          size={36}
          active={active}
        />
      </UnstyledButton>
    </Tooltip>
  );
}

const Sidebar = ({ route, open, onToggle }: SidebarProps) => {
  const { splits, invites } = useMySplits();
  const { profile } = useProfile();
  const openNewSplit = useOpenNewSplit();
  const activeSplitId = route.view === 'split' ? route.id : null;
  const name = profile ? nameFor(profile.email, profile.displayName) : '';

  const account = (
    <UnstyledButton
      className={open ? classes.account : classes.railAvatar}
      onClick={() => navigate('?settings')}
      aria-label="Settings"
    >
      <UserAvatar
        preview={false}
        name={name}
        email={profile?.email}
        avatarVersion={profile?.avatarVersion}
        previewSrc={profile?.avatarPreview}
      />
      {open && (
        <>
          <div className="min-w-0 flex-1">
            <div className={classes.accountName}>{name}</div>
            <div className={classes.accountEmail}>{profile?.email}</div>
          </div>
          <GearSix
            size={16}
            className="sf-muted"
          />
        </>
      )}
    </UnstyledButton>
  );

  if (!open) {
    return (
      <nav
        className={classes.rail}
        aria-label="Splits"
      >
        <Tooltip
          label="Expand sidebar  ["
          position="right"
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size={36}
            onClick={onToggle}
            aria-label="Expand sidebar"
          >
            <SidebarSimple size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label="New split"
          position="right"
        >
          <ActionIcon
            variant="default"
            size={36}
            onClick={openNewSplit}
            aria-label="New split"
          >
            <Plus size={18} />
          </ActionIcon>
        </Tooltip>
        <div className={classes.railDivider} />
        <div className={classes.railSplits}>
          <SortableSplits
            onMove={moveSplit}
            ids={splits?.map((s) => s.id) ?? []}
          >
            {splits?.map((s) => (
              <RailTile
                key={s.id}
                split={s}
                active={s.id === activeSplitId}
              />
            ))}
          </SortableSplits>
        </div>
        <div className={classes.railTheme}>
          <ThemeToggle size={36} />
        </div>
        {account}
      </nav>
    );
  }

  return (
    <nav
      className={classes.sidebar}
      aria-label="Main"
    >
      <div className={classes.brand}>
        <UnstyledButton
          className={classes.brandLink}
          onClick={() => navigate('')}
          aria-label="Splitfoolish, go to My splits"
        >
          <ArrowsSplit
            size={22}
            className={classes.brandIcon}
          />
          <span>Splitfoolish</span>
        </UnstyledButton>
        <ThemeToggle />
        <Tooltip label="Collapse sidebar  [">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={30}
            onClick={onToggle}
            aria-label="Collapse sidebar"
          >
            <SidebarSimple size={18} />
          </ActionIcon>
        </Tooltip>
      </div>

      {activeSplitId == null ? (
        <div className={classes.navList}>
          <NavItem
            icon={<Stack size={18} />}
            label="My splits"
            active={route.view === 'home' && route.tab !== 'invites'}
            onClick={() => navigate('')}
          />
          <NavItem
            icon={<EnvelopeSimple size={18} />}
            label="Invites"
            active={route.view === 'home' && route.tab === 'invites'}
            onClick={() => navigate('?tab=invites')}
            badge={countActionableInvites(invites)}
          />
          <NavItem
            icon={<ArrowsLeftRight size={18} />}
            label="Convert"
            active={route.view === 'convert'}
            onClick={() => navigate('?convert')}
          />
          <NavItem
            icon={<GearSix size={18} />}
            label="Settings"
            active={route.view === 'settings'}
            onClick={() => navigate('?settings')}
          />
        </div>
      ) : (
        <>
          <Button
            variant="default"
            justify="flex-start"
            leftSection={<Plus size={16} />}
            onClick={openNewSplit}
          >
            New split
          </Button>
          <div className={classes.splitsSection}>
            <UnstyledButton
              className={classes.splitsHeader}
              onClick={() => navigate('')}
            >
              <span>Splits</span>
              <span className={classes.seeAll}>
                See all <CaretRight size={12} />
              </span>
            </UnstyledButton>
            <div className={classes.splitList}>
              <SortableSplits
                onMove={moveSplit}
                ids={splits?.map((s) => s.id) ?? []}
              >
                {splits?.map((s) => (
                  <SplitRow
                    key={s.id}
                    split={s}
                    active={s.id === activeSplitId}
                  />
                ))}
              </SortableSplits>
            </div>
          </div>
        </>
      )}

      {account}
    </nav>
  );
};

export default Sidebar;
