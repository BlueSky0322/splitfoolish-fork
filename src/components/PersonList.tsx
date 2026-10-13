import { ActionIcon, Autocomplete, TextInput, Title, Tooltip } from '@mantine/core';
import IconMinus from '~icons/tabler/minus';
import IconPlus from '~icons/tabler/plus';
import IconTrashX from '~icons/tabler/trash-x';
import React, { useContext, useRef, useState } from 'react';
import { AppContext } from '../context/AppContext/AppContext';

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
  const { state, dispatch } = useContext(AppContext);
  const [name, setName] = useState('');
  // Autocomplete writes the picked option into the box right after onOptionSubmit
  const justPicked = useRef(false);

  const addPerson = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    dispatch({ type: 'ADD_PERSON', payload: trimmed });
    setName('');
  };

  const handlePersonSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    addPerson(name);
  };

  // Offer members and invitees who aren't in the split yet, keyed by the name they'd get
  const existing = new Set(state.people.map((p) => p.name.toLowerCase()));
  const offered = new Map<string, PersonSuggestion>();
  for (const s of suggestions) {
    const n = nameFromEmail(s.email);
    if (!existing.has(n.toLowerCase()) && !offered.has(n)) offered.set(n, s);
  }

  const handlePersonRemove = (name: string) => {
    dispatch({ type: 'REMOVE_PERSON', payload: name });
  };

  return (
    <>
      <div className="flex justify-between items-baseline">
        <Title
          order={2}
          className="mb-4 text-gray-800"
        >
          Add People
        </Title>
        <Tooltip label="Clear List">
          <ActionIcon
            color="red"
            onClick={() => dispatch({ type: 'CLEAR_PEOPLE', payload: null })}
          >
            <IconTrashX />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-2">
        {state.people.map((p) => (
          <TextInput
            key={p.name}
            className="w-full"
            readOnly
            value={p.name}
            rightSection={
              <ActionIcon
                onClick={() => handlePersonRemove(p.name)}
                color="red"
              >
                <IconMinus />
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
              addPerson(value);
            }}
            data={[...offered.keys()]}
            renderOption={({ option }) => {
              const s = offered.get(option.value);
              return (
                <div>
                  <div>{option.value}</div>
                  {s && (
                    <div className="text-xs text-gray-500">
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
                <IconPlus />
              </ActionIcon>
            }
          />
        </form>
      </div>
    </>
  );
};

export default PersonList;
