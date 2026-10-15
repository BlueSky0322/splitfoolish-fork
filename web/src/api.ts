import type {
  Attachment,
  JoinResult,
  ItemNameUse,
  MyInvite,
  Ok,
  Profile as ApiProfile,
  ProfilePatch,
  RateQuote,
  SplitDetail,
  SplitSummary,
  UsedCurrencyRates,
} from '../../shared/api';
import type { PaymentMethod } from '../../shared/payments';
import type { Change, Item as ApiItem } from '../../shared/types';

export type {
  Attachment,
  MyInvite,
  ProfilePatch,
  Settings,
  SplitDetail,
  SplitInvite,
  SplitMember,
  SplitSummary,
  ThemeSetting,
} from '../../shared/api';
export type { PaymentMethod } from '../../shared/payments';
export type { Change, Role } from '../../shared/types';

/** The signed-in account, as this device holds it */
export interface Profile extends ApiProfile {
  /** On this device only: a new picture still uploading, shown in the meantime */
  avatarPreview?: string | null;
}

/** Invites that need you to do something, for the count badges */
export const actionableInvites = (invites: MyInvite[] | null) =>
  (invites ?? []).filter((i) => i.kind !== 'sent').length;

export type ItemInput = Omit<ApiItem, 'id' | 'createdAt'>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * This tab, sent with every request so that when the server tells open splits about a
 * change, the tab that made it knows to ignore it
 */
export const CLIENT_ID = crypto.randomUUID();

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  { headers, ...init }: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Client-Id': CLIENT_ID,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
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
  /** Uploads a QR code method's image; done before saving the method itself */
  setPaymentQr: (methodId: string, image: Blob) =>
    request<{ qrVersion: number }>('PUT', `/api/me/payment-qr/${methodId}`, undefined, {
      body: image,
      headers: { 'Content-Type': image.type || 'image/jpeg' },
    }),
  setAvatar: (photo: Blob) =>
    request<{ avatarVersion: number }>('PUT', '/api/me/avatar', undefined, {
      body: photo,
      headers: { 'Content-Type': photo.type || 'image/jpeg' },
    }),
  removeAvatar: () => request<Ok>('DELETE', '/api/me/avatar'),
  listSplits: () => request<{ splits: SplitSummary[] }>('GET', '/api/splits'),
  /** id is made by the app, so the new split can open before this finishes */
  /** Names of items in your splits, most recent first, with the category last given */
  itemNames: () => request<{ names: ItemNameUse[] }>('GET', '/api/item-names'),
  /** Your own order for your splits: every id, first to last */
  reorderSplits: (ids: string[]) => request<Ok>('PUT', '/api/splits/order', { ids }),
  createSplit: (id: string, name: string, currency: string) =>
    request<{ id: string }>('POST', '/api/splits', { id, name, currency }),
  getSplit: (id: string) => request<SplitDetail>('GET', splitPath(id)),
  /** Sends queued changes; keepalive lets a save finish while the page is closing */
  applyChanges: (id: string, changes: Change[]) =>
    request<Ok>('POST', `${splitPath(id)}/changes`, { changes }, { keepalive: true }),
  updateSplit: (id: string, patch: { name?: string; currency?: string }) =>
    request<Ok>('PATCH', splitPath(id), patch),
  /** Uploads a photo of an item's receipt, or of the whole split when itemId is null */
  uploadPhoto: (id: string, photo: Blob, itemId: string | null) =>
    request<Attachment>(
      'POST',
      `${splitPath(id)}/attachments${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`,
      undefined,
      { body: photo, headers: { 'Content-Type': photo.type || 'image/jpeg' } },
    ),
  deletePhoto: (id: string, attachmentId: string) =>
    request<Ok>('DELETE', `${splitPath(id)}/attachments/${encodeURIComponent(attachmentId)}`),
  setSplitPicture: (id: string, picture: Blob) =>
    request<{ pictureVersion: number }>('PUT', `${splitPath(id)}/picture`, undefined, {
      body: picture,
      headers: { 'Content-Type': picture.type || 'image/jpeg' },
    }),
  removeSplitPicture: (id: string) => request<Ok>('DELETE', `${splitPath(id)}/picture`),
  deleteSplit: (id: string) => request<Ok>('DELETE', splitPath(id)),
  resetInvite: (id: string) => request<{ inviteToken: string }>('POST', `${splitPath(id)}/invite`),
  removeMember: (id: string, email: string) =>
    request<Ok>('DELETE', `${splitPath(id)}/members/${encodeURIComponent(email)}`),
  revokeInvite: (id: string, inviteId: string) =>
    request<Ok>('DELETE', `${splitPath(id)}/invites/${encodeURIComponent(inviteId)}`),
  myInvites: () => request<{ invites: MyInvite[] }>('GET', '/api/invites'),
  acceptInvite: (inviteId: string) =>
    request<{ id: string }>('POST', `/api/invites/${encodeURIComponent(inviteId)}/accept`),
  declineInvite: (inviteId: string) =>
    request<Ok>('POST', `/api/invites/${encodeURIComponent(inviteId)}/decline`),
  /** The rate to convert `from` into `to`, for previews; the server converts again on save */
  getRate: (from: string, to: string, { fresh = false } = {}) =>
    request<RateQuote>(
      'GET',
      `/api/rates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${
        fresh ? '&fresh=1' : ''
      }`,
    ),
  /** The other currencies in your splits, with today's rate into `to` (Settings) */
  usedCurrencyRates: (to: string) =>
    request<UsedCurrencyRates>('GET', `/api/me/rates?to=${encodeURIComponent(to)}`),
  /** Opening a share link: you're in the split already, have an invite, or asked to join */
  joinSplit: (token: string) =>
    request<JoinResult>('POST', `/api/join/${encodeURIComponent(token)}`),
};

export const photoUrl = (splitId: string, attachmentId: string) =>
  `${splitPath(splitId)}/attachments/${encodeURIComponent(attachmentId)}`;

export const splitPictureUrl = (splitId: string, version: number) =>
  `${splitPath(splitId)}/picture?v=${version}`;

export const paymentQrUrl = (methodId: string, version: number) =>
  `/api/payment-qr/${methodId}?v=${version}`;

export const avatarUrl = (email: string, version: number) =>
  `/api/avatars/${encodeURIComponent(email)}?v=${version}`;

export const inviteUrl = (token: string) =>
  `${window.location.origin}/?join=${encodeURIComponent(token)}`;
