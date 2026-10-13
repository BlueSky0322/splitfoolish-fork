import { ActionIcon, Button, MultiSelect, Select, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import IconTrashX from '~icons/tabler/trash-x';
import { useContext, useEffect } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { useSplitActions } from '../hooks/useSplit';
import ItemTable from './ItemTable';
import { loadMath } from '../utils/math';
import { itemFormValidate, itemInputFromForm } from './item-form-validate';

const ItemList = () => {
  const { state } = useContext(AppContext);
  const actions = useSplitActions()!;
  const itemForm = useForm({
    mode: 'uncontrolled',
    initialValues: {
      name: '',
      cost: '',
      payer: null as string | null,
      participants: state.people.map((p) => p.name),
    },
    validate: itemFormValidate,
  });

  // Start fetching mathjs now so it's ready by the time an item is added
  useEffect(() => {
    loadMath();
  }, []);

  useEffect(() => {
    itemForm.setValues({
      participants: state.people.map((p) => p.name),
    });
  }, [state]);

  const handleItemSubmit = async (values: Record<string, any>) => {
    let input;
    try {
      const { evaluate } = await loadMath();
      input = itemInputFromForm(values, state.people, evaluate);
    } catch (error) {
      alert(error);
      return;
    }

    if (await actions.addItem(input)) itemForm.reset();
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
            onClick={() => actions.clearItems()}
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
