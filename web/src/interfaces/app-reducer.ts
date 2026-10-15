import { SplitMode } from '../../../shared/settle';
import type { Item, ItemOriginal } from '../../../shared/types';

export interface IPerson {
  id: string;
  name: string;
  /** The account this person is, when linked ("This is me") */
  memberEmail?: string | null;
}

/** Items hold the person objects they refer to; the server stores ids */
export interface IItem {
  id: string;
  name: string;
  /** In currency units */
  cost: number;
  payer: IPerson;
  participants: IPerson[];
  splitMode: SplitMode;
  /** Shares per person id, when split by shares */
  shares?: Record<string, number>;
  /** Amount per person id in currency units, when split by exact amounts */
  exact?: Record<string, number>;
  category: string | null;
  notes?: string | null;
  createdAt: number;
  /** Entered in another currency: what was typed and the rate it was converted at */
  original?: ItemOriginal | null;
}

export interface AppReducerState {
  people: IPerson[];
  items: IItem[];
}

// Items arrive as the API shapes them, referring to people by id
export type AppReducerAction =
  | { type: 'ADD_PERSON'; payload: IPerson }
  | { type: 'UPDATE_PERSON'; payload: Partial<IPerson> & { id: string } }
  | { type: 'REMOVE_PERSON'; payload: string }
  | { type: 'CLEAR_PEOPLE'; payload: null }
  | { type: 'ADD_ITEM'; payload: Item }
  | { type: 'UPDATE_ITEM'; payload: Item }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'CLEAR_ITEMS'; payload: null }
  | { type: 'LOAD_STATE'; payload: { people?: IPerson[]; items?: Item[] } };
