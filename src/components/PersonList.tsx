import { ActionIcon, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconMinus, IconPlus, IconTrashX } from '@tabler/icons-react';
import React, { useContext, useRef } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { useIndexedDb } from '../context/IDBContext/useIndexedDb.hook';

const PersonList = () => {
  const { state, dispatch } = useContext(AppContext);
  const personForm = useForm({ mode: 'uncontrolled' });
  const personInputRef = useRef<HTMLInputElement>(null);
  const { getObjectStore } = useIndexedDb();

  const handlePersonSubmit = (
    values: Record<string, any>,
    _e: React.FormEvent<HTMLFormElement> | undefined,
  ) => {
    dispatch({ type: 'ADD_PERSON', payload: values['name'] });
    getObjectStore('people', 'readwrite').add({ name: values['name'] });
    getObjectStore('people').getAll().onsuccess = (ev) => {
      console.log((ev.target as IDBRequest).result);
    };

    personForm.reset();
  };

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
              <ActionIcon color="red">
                <IconMinus onClick={() => handlePersonRemove(p.name)} />
              </ActionIcon>
            }
          ></TextInput>
        ))}
        <form
          className="flex gap-4 items-end"
          onSubmit={personForm.onSubmit(handlePersonSubmit)}
        >
          <TextInput
            autoFocus
            key={personForm.key('name')}
            {...personForm.getInputProps('name')}
            ref={personInputRef}
            className="w-full"
            rightSection={
              <ActionIcon type="submit">
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
