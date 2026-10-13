import { AppShell } from '@mantine/core';
import { useHotkeys, useLocalStorage } from '@mantine/hooks';
import { ReactNode } from 'react';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { Route } from '../../hooks/useRoute';
import Sidebar from './Sidebar';

// Desktop gets a sidebar (collapsible to a rail with the button or "["); phones and
// tablets get the page alone, each with its own top bar
const AppLayout = ({ route, children }: { route: Route; children: ReactNode }) => {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useLocalStorage({ key: 'sf-sidebar-open', defaultValue: true });
  const toggle = () => setOpen((o) => !o);
  useHotkeys([['[', toggle]]);

  if (!isDesktop) return <main className="min-h-dvh">{children}</main>;

  return (
    <AppShell
      navbar={{ width: open ? 248 : 64, breakpoint: 0 }}
      padding={0}
    >
      <AppShell.Navbar withBorder={false}>
        <Sidebar
          route={route}
          open={open}
          onToggle={toggle}
        />
      </AppShell.Navbar>
      <AppShell.Main className="h-dvh overflow-auto">{children}</AppShell.Main>
    </AppShell>
  );
};

export default AppLayout;
