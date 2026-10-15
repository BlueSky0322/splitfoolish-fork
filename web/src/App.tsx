import { Button } from '@mantine/core';
import { CloudSlash, SignIn } from '@phosphor-icons/react';
import ConvertPage from './components/convert/ConvertPage';
import JoinSplit from './components/JoinSplit';
import StateCard from './components/ui/StateCard';
import { NewSplitProvider } from './components/NewSplitDialog';
import SettingsPage from './components/settings/SettingsPage';
import SplitScreen from './components/split/SplitScreen';
import SplitsHome from './components/home/SplitsHome';
import AppLayout from './components/shell/AppLayout';
import { useRoute } from './hooks/useRoute';
import { useProfile } from './profile/ProfileContext';
import { SplitStateProvider } from './split/SplitStateContext';

// Signing in happens in front of the app (Cloudflare Access), so by the time this
// runs the user is known; /api/me just tells us who. Pages load alongside it.
function App() {
  const route = useRoute();
  const { profile, signedOut, unreachable, retry } = useProfile();

  if (signedOut) {
    return (
      <StateCard
        icon={<SignIn size={36} />}
        title="You're signed out"
        body="Sign in again to see your splits."
        action={<Button onClick={() => window.location.reload()}>Sign in</Button>}
      />
    );
  }

  if (unreachable && profile == null) {
    return (
      <StateCard
        icon={<CloudSlash size={36} />}
        title="Couldn't reach Splitfoolish"
        body="Something went wrong on our side, or with the connection. Try again in a moment."
        action={<Button onClick={retry}>Try again</Button>}
      />
    );
  }

  return (
    <NewSplitProvider>
      <AppLayout route={route}>
        {route.view === 'home' && <SplitsHome tab={route.tab} />}
        {route.view === 'join' && <JoinSplit token={route.token} />}
        {route.view === 'settings' && <SettingsPage />}
        {route.view === 'convert' && <ConvertPage />}
        {route.view === 'split' && (
          <SplitStateProvider key={route.id}>
            <SplitScreen
              splitId={route.id}
              myEmail={profile?.email ?? null}
            />
          </SplitStateProvider>
        )}
      </AppLayout>
    </NewSplitProvider>
  );
}

export default App;
