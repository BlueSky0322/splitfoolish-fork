import { ApiItem } from './context/AppContext/app-reducer';
import { IPerson } from './interfaces/app-reducer';

export type Role = 'owner' | 'editor';

export interface SplitSummary {
  id: string;
  name: string;
  currency: string;
  role: Role;
  memberCount: number;
  peopleCount: number;
  totalCents: number;
  /** Null when no one in the split is linked to this account */
  myBalanceCents: number | null;
  updatedAt: number;
}

export type ThemeSetting = 'dark' | 'light' | 'auto';

export interface PaymentMethod {
  id: string;
  type: string;
  detail: string;
}

export interface Profile {
  email: string;
  displayName: string | null;
  theme: ThemeSetting;
  accent: string;
  lastCurrency: string | null;
  avatarVersion: number | null;
  paymentMethods: PaymentMethod[];
  preferredPaymentMethodId: string | null;
}

export type ProfilePatch = Partial<Pick<Profile, 'displayName' | 'theme' | 'accent'>>;

export interface SplitMember {
  email: string;
  role: Role;
  displayName: string | null;
  avatarVersion: number | null;
  /** Preferred first */
  paymentMethods: PaymentMethod[];
}

export interface Attachment {
  id: string;
  /** Null for a photo of the whole split */
  itemId: string | null;
  size: number;
  uploadedBy: string;
  createdAt: number;
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
  currency: string;
  role: Role;
  members: SplitMember[];
  /** Pending email invites; only sent to the owner */
  invites?: SplitInvite[];
  inviteToken?: string;
  attachments: Attachment[];
  people: IPerson[];
  items: ApiItem[];
}

export type ItemInput = Omit<ApiItem, 'id' | 'createdAt'>;

/** One change to a split's people or items; ids are made by the client */
export type Change =
  | { op: 'addPerson'; id: string; name: string; memberEmail?: string | null }
  | { op: 'renamePerson'; id: string; name: string }
  | { op: 'linkPerson'; id: string; memberEmail: string | null }
  | { op: 'removePerson'; id: string; fromItems?: boolean }
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
  me: () => request<Profile>('GET', '/api/me'),
  updateMe: (patch: ProfilePatch) => request<Profile>('PATCH', '/api/me', patch),
  listSplits: () => request<{ splits: SplitSummary[] }>('GET', '/api/splits'),
  createSplit: (name: string, currency: string) =>
    request<{ id: string }>('POST', '/api/splits', { name, currency }),
  getSplit: (id: string) => request<SplitDetail>('GET', splitPath(id)),
  /** Sends queued changes; keepalive lets a save finish while the page is closing */
  applyChanges: (id: string, changes: Change[]) =>
    request<{ ok: true }>('POST', `${splitPath(id)}/changes`, { changes }, { keepalive: true }),
  updateSplit: (id: string, patch: { name?: string; currency?: string }) =>
    request<{ ok: true }>('PATCH', splitPath(id), patch),
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

export const avatarUrl = (email: string, version: number) =>
  `/api/avatars/${encodeURIComponent(email)}?v=${version}`;

export const inviteUrl = (token: string) =>
  `${window.location.origin}/?join=${encodeURIComponent(token)}`;

/** Where an emailed-in invitee goes to find their pending invites */
export const invitesPageUrl = () => `${window.location.origin}/?tab=invites`;
