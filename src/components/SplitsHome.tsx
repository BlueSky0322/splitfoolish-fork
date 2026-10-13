import { Button, Loader, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect, useState } from 'react';
import { SplitSummary, api } from '../api';
import { navigate } from '../hooks/useRoute';

const SplitsHome = () => {
  const [splits, setSplits] = useState<SplitSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const newSplitForm = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '' },
    validate: { name: (value) => (value.trim() ? null : 'Give the split a name') },
  });

  useEffect(() => {
    api
      .listSplits()
      .then(({ splits }) => setSplits(splits))
      .catch(() => setError('Could not load your splits.'));
  }, []);

  const handleCreate = async ({ name }: { name: string }) => {
    try {
      const { id } = await api.createSplit(name.trim());
      navigate(`?s=${id}`);
    } catch {
      setError('Could not create the split.');
    }
  };

  return (
    <div className="p-4">
      <Title
        order={2}
        className="mb-4 text-gray-800"
      >
        My Splits
      </Title>

      <form
        onSubmit={newSplitForm.onSubmit(handleCreate)}
        className="flex gap-2 items-start mb-6"
      >
        <TextInput
          className="flex-1"
          key={newSplitForm.key('name')}
          {...newSplitForm.getInputProps('name')}
          placeholder="Friday dinner"
          aria-label="New split name"
        />
        <Button type="submit">New Split</Button>
      </form>

      {error && <div className="text-red-600 mb-4">{error}</div>}
      {splits == null && error == null && <Loader size="sm" />}
      {splits?.length === 0 && (
        <div className="text-gray-400 text-center">No splits yet. Create one above.</div>
      )}

      <ul className="flex flex-col gap-2">
        {splits?.map((s) => (
          <li key={s.id}>
            <button
              className="w-full text-left border rounded p-3 hover:bg-gray-50"
              onClick={() => navigate(`?s=${s.id}`)}
            >
              <div className="font-semibold">{s.name}</div>
              <div className="text-xs text-gray-500">
                {s.role === 'owner' ? 'Owner' : 'Shared with you'} · {s.memberCount}{' '}
                {s.memberCount === 1 ? 'person' : 'people'} · updated{' '}
                {new Date(s.updatedAt).toLocaleDateString()}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SplitsHome;
