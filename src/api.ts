import { ApiItem } from './context/AppContext/app-reducer';
import { IPerson } from './interfaces/app-reducer';

export type Role = 'owner' | 'editor';

export interface SplitSummary {
  id: string;
  name: string;
  role: Role;
  memberCount: number;
  updatedAt: number;
}

export interface SplitMember {
  email: string;
  role: Role;
}

export interface SplitInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

export interface MyInvite {
  id: string;
  splitId: string;
  splitName: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface SplitDetail {
  id: string;
  name: string;
  role: Role;
  members: SplitMember[];
  /** Pending email invites; only sent to the owner */
  invites?: SplitInvite[];
  inviteToken?: string;
  people: IPerson[];
  items: ApiItem[];
}

export type ItemInput = Omit<ApiItem, 'id'>;

/** One change to a split's people or items; ids are made by the client */
export type Change =
  | { op: 'addPerson'; id: string; name: string; memberEmail?: string | null }
  | { op: 'removePerson'; id: string }
  | { op: 'clearPeople' }
  | { op: 'addItem'; item: ApiItem }
  | { op: 'updateItem'; item: ApiItem }
  | { op: 'removeItem'; id: string }
  | { op: 'clearItems' };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `${method} ${path} failed`);
  return data as T;
}

const splitPath = (id: string) => `/api/splits/${encodeURIComponent(id)}`;

export const api = {
  me: () => request<{ email: string }>('GET', '/api/me'),
  listSplits: () => request<{ splits: SplitSummary[] }>('GET', '/api/splits'),
  createSplit: (name: string) => request<{ id: string }>('POST', '/api/splits', { name }),
  getSplit: (id: string) => request<SplitDetail>('GET', splitPath(id)),
  /** Sends queued changes; keepalive lets a save finish while the page is closing */
  applyChanges: (id: string, changes: Change[]) =>
    request<{ ok: true }>('POST', `${splitPath(id)}/changes`, { changes }, { keepalive: true }),
  deleteSplit: (id: string) => request<{ ok: true }>('DELETE', splitPath(id)),
  resetInvite: (id: string) => request<{ inviteToken: string }>('POST', `${splitPath(id)}/invite`),
  removeMember: (id: string, email: string) =>
    request<{ ok: true }>('DELETE', `${splitPath(id)}/members/${encodeURIComponent(email)}`),
  inviteByEmail: (id: string, email: string) =>
    request<SplitInvite>('POST', `${splitPath(id)}/invites`, { email }),
  revokeInvite: (id: string, inviteId: string) =>
    request<{ ok: true }>('DELETE', `${splitPath(id)}/invites/${encodeURIComponent(inviteId)}`),
  myInvites: () => request<{ invites: MyInvite[] }>('GET', '/api/invites'),
  acceptInvite: (inviteId: string) =>
    request<{ id: string }>('POST', `/api/invites/${encodeURIComponent(inviteId)}/accept`),
  declineInvite: (inviteId: string) =>
    request<{ ok: true }>('POST', `/api/invites/${encodeURIComponent(inviteId)}/decline`),
  joinSplit: (token: string) =>
    request<{ id: string }>('POST', `/api/join/${encodeURIComponent(token)}`),
};

export const inviteUrl = (token: string) =>
  `${window.location.origin}/?join=${encodeURIComponent(token)}`;

/** Where an emailed-in invitee goes to find their pending invites */
export const invitesPageUrl = () => `${window.location.origin}/?tab=invites`;
