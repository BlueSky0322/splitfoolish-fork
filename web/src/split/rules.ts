import { convertCents, convertParts, toCents } from '../../../shared/rates';
import type { SplitItem, SplitState } from './state';
import { plural } from '../utils/text';

// The bill's rules that the app checks before sending a change, so it can explain a
// refusal straight away. The server checks the same rules (worker/split-content.ts);
// rules.test.ts holds both to the same cases.

/** An item paid in another currency, converted again at a typed rate, as the server does it */
export function atRate(item: SplitItem, rate: number): SplitItem {
  const original = item.original!;
  const costCents = convertCents(toCents(original.amount), rate);
  const exact =
    item.splitMode === 'exact' && original.exact
      ? Object.fromEntries(
          [
            ...convertParts(
              Object.entries(original.exact).map(([id, amount]) => [id, toCents(amount)]),
              rate,
              costCents,
            ),
          ].map(([id, cents]) => [id, cents / 100]),
        )
      : item.exact;
  return {
    ...item,
    cost: costCents / 100,
    exact,
    original: { ...original, rate, rateSource: 'manual', rateAt: Date.now() },
  };
}

/**
 * Why a person can't be removed, or null if they can. Mirrors the server: someone who
 * paid for anything stays; with fromItems they come off items they share, unless that
 * would leave an item with nobody or break an exact split.
 */
export function removeBlocker(
  state: SplitState,
  personId: string,
  fromItems: boolean,
): string | null {
  const person = state.people.find((p) => p.id === personId);
  if (person == null) return null;
  const paid = state.items.filter((i) => i.payer.id === personId).length;
  if (paid > 0)
    return `${person.name} paid for ${plural(paid, 'item')}. Edit or remove those items first.`;
  const shared = state.items.filter((i) => i.participants.some((p) => p.id === personId));
  if (shared.length === 0) return null;
  if (!fromItems) return `${person.name} is on ${plural(shared.length, 'item')}.`;
  if (shared.some((i) => i.participants.length === 1)) {
    return `${person.name} is the only person on an item. Edit or remove it first.`;
  }
  if (shared.some((i) => i.splitMode === 'exact')) {
    return `${person.name} is on an item split by exact amounts. Edit that item first.`;
  }
  return null;
}
