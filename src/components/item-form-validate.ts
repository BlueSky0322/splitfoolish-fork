// Shared by the add and edit item forms. An item saved without a payer or
// participants breaks the item table and settlements.
export const itemFormValidate = {
  name: (value: string) => (value?.trim() ? null : 'Enter an item name'),
  cost: (value: string) => (String(value ?? '').trim() ? null : 'Enter a cost'),
  payer: (value: string | null) => (value ? null : 'Choose who paid'),
  participants: (value: string[]) =>
    value?.length ? null : 'Choose at least one person to split with',
};
