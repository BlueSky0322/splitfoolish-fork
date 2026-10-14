import { Title, UnstyledButton } from '@mantine/core';
import {
  CaretLeft,
  CaretRight,
  CurrencyCircleDollar,
  DownloadSimple,
  HandCoins,
  Icon,
  Palette,
  SignOut,
  UserCircle,
} from '@phosphor-icons/react';
import { ReactNode, useEffect, useState } from 'react';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { navigate } from '../../hooks/useRoute';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { clearCache } from '../../split-cache';
import { InstallField } from '../ui/InstallApp';
import UserAvatar from '../ui/UserAvatar';
import AppearanceSection from './AppearanceSection';
import CurrencySection from './CurrencySection';
import PaymentsSection from './PaymentsSection';
import ProfileSection from './ProfileSection';
import SettingsCard from './SettingsCard';
import { Track, useSaveIndicator } from './useSaveIndicator';
import classes from './SettingsLayout.module.css';

async function signOut() {
  await clearCache();
  window.location.href = '/cdn-cgi/access/logout';
}

type SectionId = 'profile' | 'getting-paid' | 'currency' | 'appearance' | 'app';

interface Section {
  id: SectionId;
  label: string;
  icon: Icon;
  /** Under the page's title */
  blurb: string;
  render: (track: Track) => ReactNode;
}

const GROUPS: { label: string; sections: Section[] }[] = [
  {
    label: 'You',
    sections: [
      {
        id: 'profile',
        label: 'Profile',
        icon: UserCircle,
        blurb: 'How you appear to people in your splits.',
        render: (track) => <ProfileSection track={track} />,
      },
      {
        id: 'getting-paid',
        label: 'Getting paid',
        icon: HandCoins,
        blurb: 'Shown to people who owe you, next to their transfer in Settle up.',
        render: (track) => <PaymentsSection track={track} />,
      },
    ],
  },
  {
    label: 'App',
    sections: [
      {
        id: 'currency',
        label: 'Currency',
        icon: CurrencyCircleDollar,
        blurb: "What new splits use, where rates come from, and today's rates.",
        render: (track) => <CurrencySection track={track} />,
      },
      {
        id: 'appearance',
        label: 'Appearance',
        icon: Palette,
        blurb: 'How Splitfoolish looks on this device.',
        render: (track) => <AppearanceSection track={track} />,
      },
      {
        id: 'app',
        label: 'Install app',
        icon: DownloadSimple,
        blurb: 'Splitfoolish as an app on your phone or computer.',
        render: () => (
          <SettingsCard>
            <InstallField />
          </SettingsCard>
        ),
      },
    ],
  },
];

const SECTIONS = GROUPS.flatMap((g) => g.sections);

const sectionFromHash = () => {
  const id = window.location.hash.slice(1);
  return SECTIONS.find((s) => s.id === id) ?? null;
};

/** The section in the address (?settings#currency), following back and forward */
function useSectionHash() {
  const [section, setSection] = useState(sectionFromHash);
  useEffect(() => {
    const update = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    window.addEventListener('routechange', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      window.removeEventListener('routechange', update);
    };
  }, []);
  return section;
}

/** Opened from the phone's Settings list, so Back returns to it */
const FROM_LIST = 'sfSettingsFromList';

const open = (id: SectionId, fromList: boolean) => {
  navigate(`?settings#${id}`);
  if (fromList) window.history.replaceState({ [FROM_LIST]: true }, '');
};

// Settings (9a–9d): a menu of sections, each its own page. Computers show the menu beside
// the open page; phones show the menu as the Settings home, opening each page full
// screen. Everything saves as it changes.
const SettingsPage = () => {
  const { profile } = useProfile();
  const isDesktop = useIsDesktop();
  const hashed = useSectionHash();
  const { track, note } = useSaveIndicator();
  if (profile == null) return null;
  const myName = nameFor(profile.email, profile.displayName);

  const page = (section: Section) => (
    <div
      className={classes.content}
      key={section.id}
    >
      <div className={classes.pageHead}>
        <div className="min-w-0 flex-1">
          {isDesktop ? (
            <Title
              order={3}
              className={classes.pageTitle}
            >
              {section.label}
            </Title>
          ) : null}
          <p className={classes.pageBlurb}>{section.blurb}</p>
        </div>
        {isDesktop && note}
      </div>
      {section.render(track)}
    </div>
  );

  const menuItem = (section: Section, selected: boolean) => (
    <UnstyledButton
      key={section.id}
      className={isDesktop ? classes.menuItem : classes.listRow}
      data-selected={selected || undefined}
      aria-current={selected ? 'page' : undefined}
      onClick={() => open(section.id, !isDesktop)}
    >
      <section.icon size={isDesktop ? 17 : 20} />
      <span className="min-w-0 flex-1 truncate">{section.label}</span>
      {!isDesktop && <CaretRight size={16} />}
    </UnstyledButton>
  );

  const signOutButton = (
    <UnstyledButton
      className={`${isDesktop ? classes.menuItem : classes.listRow} ${classes.signOut}`}
      onClick={() => void signOut()}
    >
      <SignOut size={isDesktop ? 17 : 20} />
      <span>Sign out</span>
    </UnstyledButton>
  );

  if (isDesktop) {
    const current = hashed ?? SECTIONS[0];
    return (
      <div className={classes.desktop}>
        <div className={classes.block}>
          <nav
            className={classes.menu}
            aria-label="Settings"
          >
            {GROUPS.map((group) => (
              <div
                key={group.label}
                className={classes.menuGroup}
              >
                <div className={classes.menuLabel}>{group.label}</div>
                {group.sections.map((s) => menuItem(s, s.id === current.id))}
              </div>
            ))}
            <hr className={classes.menuRule} />
            {signOutButton}
          </nav>
          {page(current)}
        </div>
      </div>
    );
  }

  // Phones: a section's page, or the list of them
  const back = () => {
    const state = window.history.state as Record<string, unknown> | null;
    if (hashed && state?.[FROM_LIST]) window.history.back();
    else navigate(hashed ? '?settings' : '', { replace: Boolean(hashed) });
  };

  return (
    <div className={classes.mobile}>
      <div className={classes.topBar}>
        <UnstyledButton
          className={classes.back}
          onClick={back}
          aria-label={hashed ? 'Back to Settings' : 'Back to My splits'}
        >
          <CaretLeft size={20} />
          <span>{hashed ? hashed.label : 'Settings'}</span>
        </UnstyledButton>
        {note}
      </div>

      {hashed ? (
        page(hashed)
      ) : (
        <>
          <UnstyledButton
            className={classes.mobileIdentity}
            onClick={() => open('profile', true)}
          >
            <UserAvatar
              name={myName}
              email={profile.email}
              avatarVersion={profile.avatarVersion}
              previewSrc={profile.avatarPreview}
              size={52}
              preview={false}
            />
            <span className="min-w-0 flex-1">
              <span className={classes.identityName}>{myName}</span>
              <span className={classes.identityEmail}>{profile.email}</span>
            </span>
            <CaretRight size={16} />
          </UnstyledButton>
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className={classes.listLabel}>{group.label}</div>
              <div className={classes.list}>{group.sections.map((s) => menuItem(s, false))}</div>
            </div>
          ))}
          <div className={classes.list}>{signOutButton}</div>
        </>
      )}
    </div>
  );
};

export default SettingsPage;
