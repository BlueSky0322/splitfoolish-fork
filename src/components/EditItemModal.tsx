import { TextInput, Select, MultiSelect, Button } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { IItem } from '../interfaces/app-reducer';
import { evaluate } from 'mathjs';
import { modals } from '@mantine/modals';
import { SplitActions } from '../hooks/useSplit';
import { itemFormValidate, itemInputFromForm } from './item-form-validate';

interface EditItemModalProps {
  item: IItem;
  // Passed in because modals render outside the split page's context
  actions: SplitActions;
}
const EditItemModal = ({ item, actions }: EditItemModalProps) => {
  const { state } = useContext(AppContext);
  const [saving, setSaving] = useState(false);
  const itemForm = useForm({
    mode: 'uncontrolled',
    initialValues: {
      name: item.name,
      cost: item.cost.toString(),
      payer: item.payer?.name ?? null,
      participants: item.participants.map((p) => p.name),
    },
    validate: itemFormValidate,
  });

  const handleItemSubmit = async (values: Record<string, any>) => {
    let input;
    try {
      input = itemInputFromForm(values, state.people, evaluate);
    } catch (error) {
      alert(error);
      return;
    }

    setSaving(true);
    if (await actions.updateItem(item.id, input)) modals.closeAll();
    setSaving(false);
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
        disabled={saving}
      >
        Save Item
      </Button>
    </form>
  );
};

export default EditItemModal;
