import { createContext, useContext } from 'react';
import { personColor } from '../../split/person-colors';

/**
 * Each person's colour in the open split (personColors), by person id and, for people
 * linked to an account, by its email, so an account shows in its person's colour
 */
export const PersonColorsContext = createContext<{
  byPerson: Map<string, number>;
  byEmail: Map<string, number>;
}>({ byPerson: new Map(), byEmail: new Map() });

type Who = { personId?: string | null; email?: string | null };

/**
 * Looks up colours as CSS, for lists: a person's by id, an account's by its email (that
 * of the person it's linked to). Null outside a split, or for an account no one is.
 */
export function usePersonColors() {
  const { byPerson, byEmail } = useContext(PersonColorsContext);
  return (who: Who) => {
    const color =
      (who.personId != null ? byPerson.get(who.personId) : undefined) ??
      (who.email != null ? byEmail.get(who.email) : undefined);
    return color == null ? null : personColor(color);
  };
}

/** One person's or account's colour as CSS (see usePersonColors) */
export const usePersonColor = (who: Who) => usePersonColors()(who);
