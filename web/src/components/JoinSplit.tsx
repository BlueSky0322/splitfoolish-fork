import { Button } from '@mantine/core';
import { CircleNotch, CloudSlash, LinkBreak } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { navigate } from '../hooks/useRoute';
import StateCard from './ui/StateCard';
import { reloadHomeData } from '../home/home-data';

const JoinSplit = ({ token }: { token: string }) => {
  // 'gone': the link isn't valid any more; 'failed': it couldn't be checked just now
  const [problem, setProblem] = useState<'gone' | 'failed' | null>(null);
  // Bumped to try again
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setProblem(null);
    let cancelled = false;
    api
      .joinSplit(token)
      .then((result) => {
        if (cancelled) return;
        void reloadHomeData();
        // Already in it: straight in. Otherwise the invite (or request) waits in Invites
        navigate(
          result.status === 'member'
            ? `?s=${result.id}`
            : `?tab=invites&invite=${encodeURIComponent(result.inviteId)}`,
          { replace: true },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProblem(err instanceof ApiError && err.status === 404 ? 'gone' : 'failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (problem === 'failed') {
    return (
      <StateCard
        tag="Invite link"
        icon={<CloudSlash size={36} />}
        title="Couldn't open the invite"
        body="Something went wrong, or there's no connection. The link may still work."
        action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
      />
    );
  }

  if (problem === 'gone') {
    return (
      <StateCard
        tag="Invite link"
        icon={<LinkBreak size={36} />}
        title="This invite link no longer works"
        body="The owner may have reset it. Ask them for a new one."
        action={<Button onClick={() => navigate('', { replace: true })}>Go to My splits</Button>}
      />
    );
  }

  return (
    <StateCard
      tag="Invite link"
      icon={
        <CircleNotch
          size={36}
          className="animate-spin"
        />
      }
      title="Opening the invite…"
      action={
        <Button
          variant="default"
          onClick={() => navigate('', { replace: true })}
        >
          Cancel
        </Button>
      }
    />
  );
};

export default JoinSplit;
