import { Minus, Plus, Trash } from '@phosphor-icons/react';
import { ActionIcon, Autocomplete, TextInput, Title, Tooltip } from '@mantine/core';
import React, { useContext, useRef, useState } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { useSplitActions } from '../hooks/useSplit';

export interface PersonSuggestion {
  email: string;
  status: 'member' | 'invited';
}

/** The name a member or invitee is added under: their email before the @ */
const nameFromEmail = (email: string) => email.split('@')[0];

interface PersonListProps {
  /** Split members and pending invitees, offered first when adding people */
  suggestions?: PersonSuggestion[];
}

const PersonList = ({ suggestions = [] }: PersonListProps) => {
  const { state } = useContext(AppContext);
  const actions = useSplitActions()!;
  const [name, setName] = useState('');
  // Autocomplete writes the picked option into the box right after onOptionSubmit
  const justPicked = useRef(false);

  const handlePersonSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    if (actions.addPerson(trimmed)) setName('');
  };

  // Offer members and invitees who aren't in the split yet, keyed by the name they'd get
  const existing = new Set(state.people.map((p) => p.name.toLowerCase()));
  const offered = new Map<string, PersonSuggestion>();
  for (const s of suggestions) {
    const n = nameFromEmail(s.email);
    if (!existing.has(n.toLowerCase()) && !offered.has(n)) offered.set(n, s);
  }

  return (
    <>
      <div className="flex justify-between items-baseline">
        <Title
          order={2}
          className="mb-4"
        >
          Add People
        </Title>
        <Tooltip label="Clear List">
          <ActionIcon
            color="red"
            onClick={() => actions.clearPeople()}
          >
            <Trash size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-2">
        {state.people.map((p) => (
          <TextInput
            key={p.id}
            className="w-full"
            readOnly
            value={p.name}
            rightSection={
              <ActionIcon
                onClick={() => actions.removePerson(p.id)}
                color="red"
              >
                <Minus size={18} />
              </ActionIcon>
            }
          ></TextInput>
        ))}
        <form
          className="flex gap-4 items-end"
          onSubmit={handlePersonSubmit}
        >
          <Autocomplete
            autoFocus
            className="w-full"
            aria-label="Add a person"
            placeholder={offered.size > 0 ? 'Pick someone invited, or type a name' : 'Type a name'}
            value={name}
            onChange={(value) => {
              setName(justPicked.current ? '' : value);
              justPicked.current = false;
            }}
            onOptionSubmit={(value) => {
              justPicked.current = true;
              actions.addPerson(value, offered.get(value)?.email);
            }}
            data={[...offered.keys()]}
            renderOption={({ option }) => {
              const s = offered.get(option.value);
              return (
                <div>
                  <div>{option.value}</div>
                  {s && (
                    <div className="text-xs sf-muted">
                      {s.email} · {s.status === 'member' ? 'has access' : 'invited'}
                    </div>
                  )}
                </div>
              );
            }}
            rightSection={
              <ActionIcon
                type="submit"
                aria-label="Add person"
              >
                <Plus size={18} />
              </ActionIcon>
            }
          />
        </form>
      </div>
    </>
  );
};

export default PersonList;
