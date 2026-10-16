import { UnstyledButton } from '@mantine/core';
import { ArrowsLeftRight, EnvelopeSimple, Receipt } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { countActionableInvites } from '../../api';
import { type Route, type Tab, goToTab, tabOf } from '../../hooks/useRoute';
import { useMySplits } from '../../my-splits/useMySplits';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import UserAvatar from '../common/UserAvatar';
import classes from './BottomTabs.module.css';
import { useTabsHidden } from './tabs-visibility';

// The phone's way around: Splits, Invites, Convert and You, on every top-level page and
// inside a split. Hidden while picking items (tabs-visibility.ts).

const TabButton = ({
  tab,
  label,
  icon,
  current,
  badge,
}: {
  tab: Tab;
  label: string;
  icon: ReactNode;
  current: Tab | null;
  badge?: number;
}) => (
  <UnstyledButton
    className={classes.tab}
    data-active={current === tab || undefined}
    aria-current={current === tab ? 'page' : undefined}
    onClick={() => goToTab(tab)}
  >
    <span className={classes.pill}>
      {icon}
      {badge ? <span className={classes.badge}>{badge}</span> : null}
    </span>
    <span className={classes.label}>{label}</span>
  </UnstyledButton>
);

const BottomTabs = ({ route }: { route: Route }) => {
  const isHidden = useTabsHidden();
  const { invites } = useMySplits();
  const { profile } = useProfile();
  const current = tabOf(route);
  if (isHidden || current == null) return null;
  return (
    <nav
      className={classes.tabs}
      aria-label="Sections"
    >
      <TabButton
        tab="splits"
        label="Splits"
        icon={<Receipt size={22} />}
        current={current}
      />
      <TabButton
        tab="invites"
        label="Invites"
        icon={<EnvelopeSimple size={22} />}
        current={current}
        badge={countActionableInvites(invites)}
      />
      <TabButton
        tab="convert"
        label="Convert"
        icon={<ArrowsLeftRight size={22} />}
        current={current}
      />
      <TabButton
        tab="you"
        label="You"
        icon={
          <UserAvatar
            preview={false}
            size={22}
            name={profile ? nameFor(profile.email, profile.displayName) : '?'}
            email={profile?.email}
            avatarVersion={profile?.avatarVersion}
            previewSrc={profile?.avatarPreview}
          />
        }
        current={current}
      />
    </nav>
  );
};

export default BottomTabs;
