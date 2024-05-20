import {
  ActionIcon,
  Button,
  MultiSelect,
  Select,
  Table,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconEdit, IconMinus, IconTrashX } from '@tabler/icons-react';
import { evaluate } from 'mathjs';
import React, { useContext, useEffect } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { IItem } from '../interfaces/app-reducer';
import { modals } from '@mantine/modals';
import EditItemModal from './EditItemModal';

const ItemList = () => {
  const maxShownParticipants = 3;
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
    _e: React.FormEvent<HTMLFormElement> | undefined
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

  const handleItemRemove = (ix: number) => {
    dispatch({ type: 'REMOVE_ITEM', payload: ix });
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

      <div className="flex justify-between items-baseline">
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
      <Table className="my-4">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>Paid by</Table.Th>
            <Table.Th className="hidden md:table-cell">Participants</Table.Th>
            <Table.Th></Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {state.items.length === 0 ? (
            <Table.Tr>
              <Table.Td
                className="text-center text-gray-400"
                colSpan={5}
              >
                There are no items to show.
              </Table.Td>
            </Table.Tr>
          ) : null}
          {state.items.map((i, ix) => (
            <Table.Tr key={ix}>
              <Table.Td>{i.name}</Table.Td>
              <Table.Td align="right">RM {i.cost.toFixed(2)}</Table.Td>
              <Table.Td>{i.payer.name}</Table.Td>
              <Table.Td className="hidden md:table-cell">
                <span>
                  {i.participants
                    .slice(0, maxShownParticipants)
                    .map((p) => p.name)
                    .join(', ')}{' '}
                  {i.participants.length > maxShownParticipants ? (
                    <Tooltip
                      label={i.participants
                        .slice(maxShownParticipants)
                        .map((p) => p.name)
                        .join(', ')}
                    >
                      <span className="text-blue-900 underline">
                        and {i.participants.length - maxShownParticipants} others
                      </span>
                    </Tooltip>
                  ) : null}
                </span>
              </Table.Td>
              <Table.Td>
                <div className="flex gap-2">
                  <ActionIcon>
                    <IconEdit
                      onClick={() => {
                        modals.open({
                          title: 'Edit Item',
                          children: (
                            <EditItemModal
                              item={i}
                              itemIndex={ix}
                            />
                          ),
                        });
                      }}
                    />
                  </ActionIcon>
                  <ActionIcon color="red">
                    <IconMinus onClick={() => handleItemRemove(ix)} />
                  </ActionIcon>
                </div>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot className="border-double border-t-4">
          <Table.Tr>
            <Table.Td></Table.Td>
            <Table.Td
              className="font-bold"
              align="right"
            >
              RM {state.items.reduce((sum, o) => sum + o.cost, 0).toFixed(2)}
            </Table.Td>
            <Table.Td></Table.Td>
            <Table.Td className="hidden md:table-cell"></Table.Td>
            <Table.Td></Table.Td>
          </Table.Tr>
        </Table.Tfoot>
      </Table>
    </>
  );
};

export default ItemList;
