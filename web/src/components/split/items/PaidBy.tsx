import type { SplitItem } from '../../../split/state';
import { PersonName } from '../PersonAvatar';
import { onlyFor } from './only-for';

/** Paid by someone only for themselves: nothing anyone owes */
const ownOf = (item: SplitItem) => onlyFor(item)?.id === item.payer.id;

// Who paid, in a few words: "Ryan's own" when they paid only for themselves, "Ryan paid
// for simpson" when it's for one other person, else "Ryan paid"
export const PaidBy = ({ item }: { item: SplitItem }) => {
  const one = onlyFor(item);
  if (one && ownOf(item)) {
    return (
      <>
        <PersonName person={item.payer} />
        &apos;s own
      </>
    );
  }
  return (
    <>
      <PersonName person={item.payer} /> paid
      {one && (
        <>
          {' for '}
          <PersonName person={one} />
        </>
      )}
    </>
  );
};

// Whom an item is for, where the payer is shown apart: "Their own" or "For simpson";
// nothing when it's shared
export const ForWhom = ({ item }: { item: SplitItem }) => {
  const one = onlyFor(item);
  if (one == null) return null;
  if (ownOf(item)) return <>Their own</>;
  return (
    <>
      For <PersonName person={one} />
    </>
  );
};
