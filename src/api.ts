import type { Change, Item as ApiItem, Role } from '../shared/types';
import { IPerson } from './interfaces/app-reducer';

export type { Change, Role };

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
  /** Null when the split has no picture */
  pictureVersion: number | null;
  updatedAt: number;
}

export type ThemeSetting = 'dark' | 'light' | 'auto';

export interface PaymentMethod {
  id: string;
  type: string;
  detail: string;
}

export interface Settings {
  theme: ThemeSetting;
  accent: string;
  /** The default currency for new splits */
  lastCurrency: string | null;
  sidebarOpen: boolean;
  itemsView: 'card' | 'table';
  itemsGroupBy: 'none' | 'day' | 'payer' | 'category';
  itemsSortKey: 'date' | 'name' | 'payer' | 'amount';
  itemsSortDir: 'asc' | 'desc';
}

/** The signed-in account: what others see of it, and its private settings */
export interface Profile {
  email: string;
  displayName: string | null;
  avatarVersion: number | null;
  paymentMethods: PaymentMethod[];
  preferredPaymentMethodId: string | null;
  settings: Settings;
  /** On this device only: a new picture still uploading, shown in the meantime */
  avatarPreview?: string | null;
}

export interface ProfilePatch {
  displayName?: string | null;
  settings?: Partial<Settings>;
}

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
  /** The inviter's display name, if they set one */
  invitedByName: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface SplitDetail {
  id: string;
  name: string;
  currency: string;
  /** Everyone settles up through this person; null for the fewest transfers */
  distributorId: string | null;
  pictureVersion: number | null;
  /** Its items are being converted into a new currency, in the background */
  converting?: boolean;
  role: Role;
  members: SplitMember[];
  /** Pending email invites; only sent to the owner */
  invites?: SplitInvite[];
  inviteToken?: string;
  attachments: Attachment[];
  // Copies cached on this device may predate memberEmail, so it's optional here
  people: IPerson[];
  items: ApiItem[];
}

export type ItemInput = Omit<ApiItem, 'id' | 'createdAt'>;

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
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Lets a call send something other than JSON, such as a photo
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const { error } = data as { error?: string };
    throw new ApiError(res.status, error ?? `${method} ${path} failed`);
  }
  return data as T;
}

const splitPath = (id: string) => `/api/splits/${encodeURIComponent(id)}`;

export const api = {
  me: () => request<Profile>('GET', '/api/me'),
  updateMe: (patch: ProfilePatch) => request<Profile>('PATCH', '/api/me', patch),
  /** Replaces all payment methods and which one is preferred */
  setPaymentMethods: (methods: PaymentMethod[], preferredId: string | null) =>
    request<Profile>('PUT', '/api/me/payment-methods', { methods, preferredId }),
  setAvatar: (photo: Blob) =>
    request<{ avatarVersion: number }>('PUT', '/api/me/avatar', undefined, {
      body: photo,
      headers: { 'Content-Type': photo.type || 'image/jpeg' },
    }),
  removeAvatar: () => request<{ ok: true }>('DELETE', '/api/me/avatar'),
  listSplits: () => request<{ splits: SplitSummary[] }>('GET', '/api/splits'),
  /** id is made by the app, so the new split can open before this finishes */
  createSplit: (id: string, name: string, currency: string) =>
    request<{ id: string }>('POST', '/api/splits', { id, name, currency }),
  getSplit: (id: string) => request<SplitDetail>('GET', splitPath(id)),
  /** Sends queued changes; keepalive lets a save finish while the page is closing */
  applyChanges: (id: string, changes: Change[]) =>
    request<{ ok: true }>('POST', `${splitPath(id)}/changes`, { changes }, { keepalive: true }),
  updateSplit: (id: string, patch: { name?: string; currency?: string }) =>
    request<{ ok: true }>('PATCH', splitPath(id), patch),
  /** Uploads a photo of an item's receipt, or of the whole split when itemId is null */
  uploadPhoto: (id: string, photo: Blob, itemId: string | null) =>
    request<Attachment>(
      'POST',
      `${splitPath(id)}/attachments${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`,
      undefined,
      { body: photo, headers: { 'Content-Type': photo.type || 'image/jpeg' } },
    ),
  deletePhoto: (id: string, attachmentId: string) =>
    request<{ ok: true }>(
      'DELETE',
      `${splitPath(id)}/attachments/${encodeURIComponent(attachmentId)}`,
    ),
  setSplitPicture: (id: string, picture: Blob) =>
    request<{ pictureVersion: number }>('PUT', `${splitPath(id)}/picture`, undefined, {
      body: picture,
      headers: { 'Content-Type': picture.type || 'image/jpeg' },
    }),
  removeSplitPicture: (id: string) => request<{ ok: true }>('DELETE', `${splitPath(id)}/picture`),
  deleteSplit: (id: string) => request<{ ok: true }>('DELETE', splitPath(id)),
  resetInvite: (id: string) => request<{ inviteToken: string }>('POST', `${splitPath(id)}/invite`),
  removeMember: (id: string, email: string) =>
    request<{ ok: true }>('DELETE', `${splitPath(id)}/members/${encodeURIComponent(email)}`),
  revokeInvite: (id: string, inviteId: string) =>
    request<{ ok: true }>('DELETE', `${splitPath(id)}/invites/${encodeURIComponent(inviteId)}`),
  myInvites: () => request<{ invites: MyInvite[] }>('GET', '/api/invites'),
  acceptInvite: (inviteId: string) =>
    request<{ id: string }>('POST', `/api/invites/${encodeURIComponent(inviteId)}/accept`),
  declineInvite: (inviteId: string) =>
    request<{ ok: true }>('POST', `/api/invites/${encodeURIComponent(inviteId)}/decline`),
  /** The rate to convert `from` into `to`, for previews; the server converts again on save */
  getRate: (from: string, to: string) =>
    request<{ rate: number; source: 'wise' | 'frankfurter'; fetchedAt: number }>(
      'GET',
      `/api/rates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  /** Opening a share link: you're either in the split already, or now have an invite */
  joinSplit: (token: string) =>
    request<{ status: 'member'; id: string } | { status: 'invited'; id: string; inviteId: string }>(
      'POST',
      `/api/join/${encodeURIComponent(token)}`,
    ),
};

export const photoUrl = (splitId: string, attachmentId: string) =>
  `${splitPath(splitId)}/attachments/${encodeURIComponent(attachmentId)}`;

export const splitPictureUrl = (splitId: string, version: number) =>
  `${splitPath(splitId)}/picture?v=${version}`;

export const avatarUrl = (email: string, version: number) =>
  `/api/avatars/${encodeURIComponent(email)}?v=${version}`;

export const inviteUrl = (token: string) =>
  `${window.location.origin}/?join=${encodeURIComponent(token)}`;
