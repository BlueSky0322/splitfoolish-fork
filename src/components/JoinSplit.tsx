import { Button, Loader } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../hooks/useRoute';

const JoinSplit = ({ token }: { token: string }) => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .joinSplit(token)
      .then(({ id }) => navigate(`?s=${id}`, { replace: true }))
      .catch(() => setError('This invite link is no longer valid. Ask the owner for a new one.'));
  }, [token]);

  if (error == null) {
    return (
      <div className="p-8 flex justify-center">
        <Loader size="sm" />
      </div>
    );
  }

  return (
    <div className="p-8 text-center flex flex-col gap-4 items-center">
      <div>{error}</div>
      <Button
        variant="light"
        onClick={() => navigate('', { replace: true })}
      >
        Go to My Splits
      </Button>
    </div>
  );
};

export default JoinSplit;
