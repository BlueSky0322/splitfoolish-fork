import { convertCents, convertParts, toCents } from '@shared/rates';
import { removalBlocker } from '@shared/rules';
import type { SplitItem, SplitState } from './state';

// The bill's rules that the app checks before sending a change, so it can explain a
// refusal straight away. The server checks the same rules (worker/bill/),
// some of them through the same code (shared/rules.ts); bill-rules.test.ts holds both to the
// same cases.

/**
 * An item paid in another currency, converted again at a typed rate, as the server does
 * it. One paid in the split's own currency has nothing to convert, and stays as it is.
 */
export function atRate(item: SplitItem, rate: number): SplitItem {
  const { original } = item;
  if (original == null) return item;
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
 * Why a person can't be removed, or null if they can (the rules are in shared/rules.ts).
 * Without fromItems, someone on items is told only that, before being asked whether to
 * take them off those items too; the server, sent such a removal, adds "Edit or remove
 * those items first".
 */
export function removalMessage(
  state: SplitState,
  personId: string,
  fromItems: boolean,
): string | null {
  const person = state.people.find((p) => p.id === personId);
  if (person == null) return null;
  const items = state.items.map((i) => ({
    payerId: i.payer.id,
    participantIds: i.participants.map((p) => p.id),
    splitMode: i.splitMode,
  }));
  const payments = state.payments.map((p) => ({ fromId: p.from.id, toId: p.to.id }));
  return removalBlocker(person, items, fromItems, payments)?.message ?? null;
}
