import { TextInput, Select, MultiSelect, Button } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useContext } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { IItem } from '../interfaces/app-reducer';
import { evaluate } from 'mathjs';
import { modals } from '@mantine/modals';

interface EditItemModalProps {
  item: IItem;
  itemIndex: number;
}
const EditItemModal = ({ item, itemIndex }: EditItemModalProps) => {
  const { state, dispatch } = useContext(AppContext);
  const itemForm = useForm({
    mode: 'uncontrolled',
    initialValues: {
      name: item.name,
      cost: item.cost.toString(),
      payer: item.payer.name,
      participants: item.participants.map((p) => p.name),
    },
  });

  const handleItemSubmit = (
    values: Record<string, any>,
    _e: React.FormEvent<HTMLFormElement> | undefined
  ) => {
    const participants = state.people.filter((p) => values['participants'].includes(p.name));
    const payer = state.people.find((p) => p.name === values['payer']);

    try {
      dispatch({
        type: 'UPDATE_ITEM',
        payload: {
          oldItemIndex: itemIndex,
          newItem: {
            cost: evaluate(values['cost']),
            name: values['name'],
            participants,
            payer,
            strategy: values['strategy'],
          } as IItem,
        },
      });
      modals.closeAll();
    } catch (error) {
      alert(error);
    }
  };

  return (
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
        Save Item
      </Button>
    </form>
  );
};

export default EditItemModal;
