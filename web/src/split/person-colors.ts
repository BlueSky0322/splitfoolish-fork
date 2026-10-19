// A colour for each person in a split, on their avatar and beside their name, so people
// are easier to tell apart at a glance. The name is always shown too: colour only helps.
//
// The first four people get the four hues that stay clearly apart side by side (blue,
// amber, aqua, pink), in an order picked by the split's id, so each split looks
// different; the fifth and sixth get violet and orange, and after that they repeat.
// Green and red are left out: they mean owed and owing.

/** How many colours there are: --sf-person-0 to --sf-person-5 in theme/tokens.css */
export const PERSON_COLORS = 6;

/** The hues that stay apart from one another, which go first */
const DISTINCT = [0, 1, 2, 3];

/** A small, steady number from a split's id, so its order is the same everywhere */
function seed(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** The four distinct hues in an order of the split's own */
function firstFour(splitId: string) {
  const left = [...DISTINCT];
  let n = seed(splitId);
  const order: number[] = [];
  while (left.length > 0) {
    order.push(left.splice(n % left.length, 1)[0]);
    n = Math.floor(n / (left.length + 1));
  }
  return order;
}

/** Each person's colour by id, in the order people are listed in the split */
export function personColors(splitId: string, people: readonly { id: string }[]) {
  const order = [...firstFour(splitId), 4, 5];
  return new Map(people.map((p, i) => [p.id, order[i % PERSON_COLORS]]));
}

/** The CSS colour for one */
export const personColor = (color: number) => `var(--sf-person-${color % PERSON_COLORS})`;
