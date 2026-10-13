export interface IOwing {
  payer: IPerson;
  payee: IPerson;
  amount: number;
}

export interface IPerson {
  id: string;
  name: string;
  /** Set when the person was added from the split's members or invitees */
  memberEmail?: string | null;
}

/** Items hold the person objects they refer to; the server stores ids */
export interface IItem {
  id: string;
  name: string;
  cost: number;
  payer: IPerson;
  participants: IPerson[];
}

export interface AppReducerState {
  people: IPerson[];
  items: IItem[];
  owings: IOwing[];
}

export interface AppReducerAction {
  type: string;
  payload: any;
}
