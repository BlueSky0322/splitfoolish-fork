import { ActionIcon, Button, MultiSelect, Select, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconTrashX } from '@tabler/icons-react';
import { evaluate } from 'mathjs';
import React, { useContext, useEffect } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { IItem } from '../interfaces/app-reducer';
import ItemTable from './ItemTable';

const ItemList = () => {
  const { state, dispatch } = useContext(AppContext);
  const itemForm = useForm({
    mode: 'uncontrolled',
    initialValues: {
      participants: state.people.map((p) => p.name),
    },
  });

  useEffect(() => {
    itemForm.setValues({
      participants: state.people.map((p) => p.name),
    });
  }, [state]);

  const handleItemSubmit = (
    values: Record<string, any>,
    _e: React.FormEvent<HTMLFormElement> | undefined,
  ) => {
    const participants = state.people.filter((p) => values['participants'].includes(p.name));
    const payer = state.people.find((p) => p.name === values['payer']);

    try {
      dispatch({
        type: 'ADD_ITEM',
        payload: {
          cost: evaluate(values['cost']),
          name: values['name'],
          participants,
          payer,
          strategy: values['strategy'],
        } as IItem,
      });
      itemForm.reset();
    } catch (error) {
      alert(error);
    }
  };

  return (
    <>
      <Title
        order={2}
        className="mb-4 text-gray-800"
      >
        Add Items
      </Title>

      <form
        onSubmit={itemForm.onSubmit(handleItemSubmit)}
        className="grid grid-cols-2 gap-2"
      >
        <TextInput
          autoFocus
          key={itemForm.key('name')}
          {...itemForm.getInputProps('name')}
          label="Item"
          placeholder="Golf Balls"
        />
        <TextInput
          key={itemForm.key('cost')}
          {...itemForm.getInputProps('cost')}
          label="Cost"
          placeholder="16*2"
        />
        <Select
          key={itemForm.key('payer')}
          {...itemForm.getInputProps('payer')}
          label="Who paid?"
          data={state.people.map((p) => p.name)}
        />
        <MultiSelect
          key={itemForm.key('participants')}
          {...itemForm.getInputProps('participants')}
          label="Split amongst?"
          data={state.people.map((p) => p.name)}
          name="participants"
        />
        <Button
          className="mt-2 col-span-full"
          type="submit"
        >
          Add Item
        </Button>
      </form>

      <div className="mb-4 flex justify-between items-baseline">
        <Title
          order={2}
          className="mb-4 text-gray-800 mt-6"
        >
          Item List
        </Title>
        <Tooltip label="Clear List">
          <ActionIcon
            color="red"
            onClick={() => dispatch({ type: 'CLEAR_ITEMS', payload: null })}
          >
            <IconTrashX />
          </ActionIcon>
        </Tooltip>
      </div>
      <ItemTable />
    </>
  );
};

export default ItemList;
