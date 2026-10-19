import { Fragment, createContext, useContext } from 'react';
import type { Person } from '@shared/types';
import UserAvatar from '../common/UserAvatar';
import { usePersonColor } from './person-colors-context';

/** Profile picture versions by account email, for people linked to an account */
export const AvatarVersionsContext = createContext<Map<string, number | null>>(new Map());

/** A person's name in their colour */
export const PersonName = ({ person }: { person: Person }) => {
  const colors = usePersonColor({ personId: person.id });
  return <span style={colors ? { color: colors.text } : undefined}>{person.name}</span>;
};

/** "Ann, Ben, Chen", each in their colour */
export const PersonNames = ({ people }: { people: Person[] }) =>
  people.map((p, i) => (
    <Fragment key={p.id}>
      {i > 0 && ', '}
      <PersonName person={p} />
    </Fragment>
  ));

// A person in the bill: their profile picture when they're linked to an account that
// has one, else their initial on their colour
const PersonAvatar = ({
  person,
  size,
  active,
  preview,
}: {
  person: Person;
  size?: number;
  active?: boolean;
  preview?: boolean;
}) => {
  const versions = useContext(AvatarVersionsContext);
  const email = person.memberEmail ?? null;
  const colors = usePersonColor({ personId: person.id });
  return (
    <UserAvatar
      name={person.name}
      email={email}
      avatarVersion={email ? versions.get(email) : null}
      size={size}
      active={active}
      preview={preview}
      color={colors?.fill}
    />
  );
};

export default PersonAvatar;
