import { Loader } from '@mantine/core';
import { useEffect, useState } from 'react';
import './App.css';
import { api } from './api';
import JoinSplit from './components/JoinSplit';
import SplitView from './components/SplitView';
import SplitsHome from './components/SplitsHome';
import { useRoute } from './hooks/useRoute';

// Signing in happens in front of the app (Cloudflare Access), so by the time this
// runs the user is known; /api/me just tells us who.
function App() {
  const route = useRoute();
  const [email, setEmail] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(({ email }) => setEmail(email))
      .catch(() => setSignedOut(true));
  }, []);

  return (
    <div className="max-w-screen-md m-auto bg-white min-h-screen">
      {signedOut && (
        <div className="p-8 text-center">
          You're signed out. <a href={window.location.href}>Reload</a> to sign in again.
        </div>
      )}
      {!signedOut && email == null && (
        <div className="p-8 flex justify-center">
          <Loader size="sm" />
        </div>
      )}
      {email != null && (
        <>
          {route.view === 'home' && <SplitsHome />}
          {route.view === 'join' && <JoinSplit token={route.token} />}
          {route.view === 'split' && (
            <SplitView
              key={route.id}
              splitId={route.id}
              myEmail={email}
            />
          )}
          <div className="text-xs text-center text-gray-500 py-4">
            Signed in as {email} ·{' '}
            <a
              className="underline"
              href="/cdn-cgi/access/logout"
            >
              Sign out
            </a>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
