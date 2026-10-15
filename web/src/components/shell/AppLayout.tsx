import { AppShell } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import type { ReactNode } from 'react';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import type { Route } from '../../hooks/useRoute';
import { useProfile } from '../../profile/ProfileContext';
import OfflineNotice from './OfflineNotice';
import UpdateNotice from './UpdateNotice';
import Sidebar from './Sidebar';
import classes from './AppLayout.module.css';

// Desktop gets a sidebar (collapsible to a rail with the button or "["); phones and
// tablets get the page alone, each with its own top bar
const AppLayout = ({ route, children }: { route: Route; children: ReactNode }) => {
  const isDesktop = useIsDesktop();
  const { profile, rememberSettings } = useProfile();
  // Saved with the account, so it's the same on every computer
  const open = profile?.settings.sidebarOpen ?? true;
  const toggle = () => rememberSettings({ sidebarOpen: !open });
  useHotkeys([['[', toggle]]);

  if (!isDesktop) {
    return (
      <main className="min-h-dvh">
        {children}
        <OfflineNotice />
        <UpdateNotice />
      </main>
    );
  }

  return (
    <AppShell
      navbar={{ width: open ? 248 : 64, breakpoint: 0 }}
      padding={0}
    >
      <AppShell.Navbar
        withBorder={false}
        className={classes.navbar}
      >
        <Sidebar
          route={route}
          open={open}
          onToggle={toggle}
        />
      </AppShell.Navbar>
      <AppShell.Main className={`h-dvh overflow-auto ${classes.main}`}>{children}</AppShell.Main>
      <OfflineNotice />
      <UpdateNotice />
    </AppShell>
  );
};

export default AppLayout;
