import { Button } from '@mantine/core';
import { CircleNotch, LinkBreak } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { reloadHomeData } from '../hooks/useHomeData';
import { navigate } from '../hooks/useRoute';
import StateCard from './ui/StateCard';

const JoinSplit = ({ token }: { token: string }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .joinSplit(token)
      .then((result) => {
        if (cancelled) return;
        reloadHomeData();
        // Already in it: straight in. Otherwise the invite waits in Invites to be accepted
        navigate(
          result.status === 'member'
            ? `?s=${result.id}`
            : `?tab=invites&invite=${encodeURIComponent(result.inviteId)}`,
          { replace: true },
        );
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed) {
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
