import { ItemInput } from '../api';
import { IPerson } from '../interfaces/app-reducer';

// Shared by the add and edit item forms. An item saved without a payer or
// participants breaks the item table and settlements.
export const itemFormValidate = {
  name: (value: string) => (value?.trim() ? null : 'Enter an item name'),
  cost: (value: string) => (String(value ?? '').trim() ? null : 'Enter a cost'),
  payer: (value: string | null) => (value ? null : 'Choose who paid'),
  participants: (value: string[]) =>
    value?.length ? null : 'Choose at least one person to split with',
};

/** Turns the item form's values (people by name, cost as an expression) into an item to save */
export const itemInputFromForm = (
  values: Record<string, any>,
  people: IPerson[],
  evaluateCost: (expression: string) => unknown,
): ItemInput => ({
  name: values['name'].trim(),
  cost: Number(evaluateCost(values['cost'])),
  payerId: people.find((p) => p.name === values['payer'])!.id,
  participantIds: people.filter((p) => values['participants'].includes(p.name)).map((p) => p.id),
});
