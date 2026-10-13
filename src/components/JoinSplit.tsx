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
      .then(({ id }) => {
        if (cancelled) return;
        reloadHomeData();
        navigate(`?s=${id}`, { replace: true });
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
      title="Joining the split…"
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
