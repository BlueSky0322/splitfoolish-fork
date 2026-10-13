import { SplitMode } from '../../shared/settle';

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
  createdAt: number;
}

export interface AppReducerState {
  people: IPerson[];
  items: IItem[];
}

export interface AppReducerAction {
  type: string;
  payload: any;
}
