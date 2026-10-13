import { ActionIcon, Button, Tooltip, UnstyledButton } from '@mantine/core';
import {
  ArrowsSplit,
  CaretRight,
  EnvelopeSimple,
  GearSix,
  Plus,
  SidebarSimple,
  Stack,
} from '@phosphor-icons/react';
import { ReactNode } from 'react';
import { useHomeData } from '../../hooks/useHomeData';
import { Route, navigate } from '../../hooks/useRoute';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { useOpenNewSplit } from '../NewSplitDialog';
import BalanceTag from '../ui/BalanceTag';
import UserAvatar from '../ui/UserAvatar';
import classes from './Sidebar.module.css';

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

const Sidebar = ({ route, open, onToggle }: SidebarProps) => {
  const { splits, invites } = useHomeData();
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
        name={name}
        email={profile?.email}
        avatarVersion={profile?.avatarVersion}
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
          {splits?.map((s) => (
            <Tooltip
              key={s.id}
              label={s.name}
              position="right"
            >
              <UnstyledButton
                className={classes.railTile}
                data-active={s.id === activeSplitId || undefined}
                onClick={() => navigate(`?s=${s.id}`)}
                aria-label={s.name}
              >
                {s.name.charAt(0).toUpperCase()}
              </UnstyledButton>
            </Tooltip>
          ))}
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
        <ArrowsSplit
          size={22}
          className={classes.brandIcon}
        />
        <span className="flex-1">Splitfoolish</span>
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
            badge={invites?.length}
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
              {splits?.map((s) => (
                <UnstyledButton
                  key={s.id}
                  className={classes.splitRow}
                  data-active={s.id === activeSplitId || undefined}
                  aria-current={s.id === activeSplitId ? 'page' : undefined}
                  onClick={() => navigate(`?s=${s.id}`)}
                >
                  <span className={classes.splitName}>{s.name}</span>
                  <BalanceTag
                    cents={s.myBalanceCents}
                    currency={s.currency}
                  />
                </UnstyledButton>
              ))}
            </div>
          </div>
        </>
      )}

      {account}
    </nav>
  );
};

export default Sidebar;
