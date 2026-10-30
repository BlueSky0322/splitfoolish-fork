import type { Position } from './utils/here';
import type { PlaceName } from '@shared/places';
import {
  CLIENT_ID_HEADER,
  EXPECTED_ACCOUNT_HEADER,
  MAX_PHOTOS_REMOVED,
  PHOTO_ID_PARAM,
} from '@shared/api';
import type { LinkPreview } from '@shared/links';
import type {
  AcceptResult,
  ArchiveBody,
  ConnectedAgent,
  ApiErrorBody,
  ErrorCode,
  Attachment,
  AvatarResult,
  ChangesBody,
  Created,
  CreateSplitBody,
  InviteList,
  ShareTokenResult,
  ItemNames,
  JoinResult,
  MyInvite,
  Ok,
  PaymentMethodsBody,
  PaymentQrResult,
  Profile as ApiProfile,
  ProfilePatch,
  RateQuote,
  SearchResult,
  SplitDetail,
  SplitList,
  SplitOrderBody,
  SplitPatch,
  SplitPictureResult,
  UpdateSplitResult,
  UsedCurrencyRates,
  RemovePhotosBody,
} from '@shared/api';
import type { PaymentMethod } from '@shared/payments';
import type { Item as ApiItem, Payment } from '@shared/types';
import { newId } from './utils/id';

/** The signed-in account, as this device holds it */
export interface Profile extends ApiProfile {
  /** On this device only: a new picture still uploading, shown in the meantime */
  avatarPreview?: string | null;
}

/** Invites that need you to do something, for the count badges */
export const countActionableInvites = (invites: MyInvite[] | null) =>
  (invites ?? []).filter((i) => i.kind !== 'sent').length;

export type ItemInput = Omit<ApiItem, 'id' | 'createdAt'>;
/** A payment as the app saves it; the id is the app's to make */
export type PaymentInput = Omit<Payment, 'id'>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The server's own explanation, written for the person using the app */
    public explanation: string | null = null,
    /** What went wrong, where the status alone doesn't say */
    public code: ErrorCode | null = null,
  ) {
    super(message);
  }
}

/**
 * The account this page's writes are made as: the one its device copies and unsent
 * changes are kept for (offline/cache.ts sets it). The server refuses a write made as
 * anyone else, so one made before someone else signed in never lands in their account.
 */
let writingAs: string | null = null;
export const writeAs = (email: string | null) => {
  writingAs = email;
};
/** Whom this page's writes are made as now, or null before that's known */
export const writingAccount = () => writingAs;

/** No answer at all: offline, or the connection dropped on the way */
export class NetworkError extends Error {}

/**
 * This tab, sent with every request so that when the server tells open splits about a
 * change, the tab that made it knows to ignore it
 */
export const CLIENT_ID = newId();

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  { headers, ...init }: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        [CLIENT_ID_HEADER]: CLIENT_ID,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        // Reads don't need it: /api/me is how the page learns who's signed in
        ...(method !== 'GET' && writingAs != null && { [EXPECTED_ACCOUNT_HEADER]: writingAs }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Lets a call send something other than JSON, such as a photo
      ...init,
    });
  } catch (err) {
    throw new NetworkError(`${method} ${path} got no answer (${String(err)})`);
  }
  // Sent to the sign-in page: the session has run out
  if (res.redirected) throw new ApiError(401, `${method} ${path} was sent to sign in`);
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const answer = data as Partial<ApiErrorBody> | null;
    const error = answer?.error ?? null;
    throw new ApiError(
      res.status,
      error ?? `${method} ${path} failed`,
      error,
      answer?.code ?? null,
    );
  }
  // Answered by something other than the API (a proxy, say): worth trying again, like a 5xx
  if (data == null) throw new ApiError(502, `${method} ${path} didn't answer with JSON`);
  return data as T;
}

/** Sends a picture as the body, rather than JSON */
const upload = <T>(method: string, path: string, picture: Blob) =>
  request<T>(method, path, undefined, {
    body: picture,
    headers: { 'Content-Type': picture.type || 'image/jpeg' },
  });

const splitPath = (id: string) => `/api/splits/${encodeURIComponent(id)}`;

// Photos of a split or an item are "attachments" to the server, and in these calls; the
// screens call them photos
export const api = {
  getMe: () => request<Profile>('GET', '/api/me'),
  updateMe: (patch: ProfilePatch) => request<Profile>('PATCH', '/api/me', patch),
  /** Replaces all payment methods and which one is preferred */
  setPaymentMethods: (methods: PaymentMethod[], preferredId: string | null) =>
    request<Profile>('PUT', '/api/me/payment-methods', {
      methods,
      preferredId,
    } satisfies PaymentMethodsBody),
  /** Uploads a QR code method's image; done before saving the method itself */
  setPaymentQr: (methodId: string, image: Blob) =>
    upload<PaymentQrResult>('PUT', `/api/me/payment-qr/${encodeURIComponent(methodId)}`, image),
  setAvatar: (photo: Blob) => upload<AvatarResult>('PUT', '/api/me/avatar', photo),
  deleteAvatar: () => request<Ok>('DELETE', '/api/me/avatar'),
  /** Agent apps this account has let in, newest first */
  listAgents: () => request<ConnectedAgent[]>('GET', '/api/me/agents'),
  /** Ends one agent's access, and every token it holds */
  disconnectAgent: (id: string) =>
    request<Ok>('DELETE', `/api/me/agents/${encodeURIComponent(id)}`),
  listSplits: () => request<SplitList>('GET', '/api/splits'),
  /** Names of items in your splits, most recent first, with the category last given */
  listItemNames: () => request<ItemNames>('GET', '/api/item-names'),
  /** What is at a position, from OpenStreetMap */
  placeName: (lat: number, lng: number) =>
    request<PlaceName>(
      'GET',
      `/api/place-name?${new URLSearchParams({ lat: `${lat}`, lng: `${lng}` })}`,
    ),
  /** What a Google Maps link in notes shows as a card */
  linkPreview: (url: string) =>
    request<LinkPreview>('GET', `/api/link-preview?url=${encodeURIComponent(url)}`),
  /** Your own order for your splits: every id, first to last */
  reorderSplits: (ids: string[]) =>
    request<Ok>('PUT', '/api/splits/order', { ids } satisfies SplitOrderBody),
  /** id is made by the app, so the new split can open before this finishes */
  createSplit: (id: string, name: string, currency: string) =>
    request<Created>('POST', '/api/splits', { id, name, currency } satisfies CreateSplitBody),
  /** Archives a split for you (out of Active), or brings it back */
  archiveSplit: (id: string, archived: boolean) =>
    request<Ok>('PUT', '/api/archived', { id, archived } satisfies ArchiveBody),
  /** Items in your splits by name */
  searchItems: (text: string) =>
    request<SearchResult>('GET', `/api/search?q=${encodeURIComponent(text)}`),
  getSplit: (id: string) => request<SplitDetail>('GET', splitPath(id)),
  /**
   * Sends queued changes. While the page is hidden or closing, keepalive lets the save
   * finish after it's gone; browsers allow that only for small requests (nextBatch keeps
   * each one small enough), so it's not used otherwise. A send that still can't go is
   * kept on the device and sent later.
   */
  applyChanges: (id: string, body: ChangesBody) =>
    request<Ok>('POST', `${splitPath(id)}/changes`, body, {
      keepalive: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    }),
  updateSplit: (id: string, patch: SplitPatch) =>
    request<UpdateSplitResult>('PATCH', splitPath(id), patch),
  /**
   * Uploads a photo of an item's receipt, or of the whole split when itemId is null.
   * photoId is the photo's own id, so sending it again never adds it twice.
   */
  uploadAttachment: (
    id: string,
    photo: Blob,
    itemId: string | null,
    photoId: string,
    place: Position | null = null,
  ) => {
    const query = new URLSearchParams({ [PHOTO_ID_PARAM]: photoId });
    if (itemId) query.set('itemId', itemId);
    // Where it was taken, read before it was shrunk; the picture itself doesn't say
    if (place) {
      query.set('lat', String(place.lat));
      query.set('lng', String(place.lng));
    }
    return upload<Attachment>('POST', `${splitPath(id)}/attachments?${query}`, photo);
  },
  /** Removes photos, as many to a request as the server takes */
  deleteAttachments: async (id: string, attachmentIds: string[]) => {
    for (let at = 0; at < attachmentIds.length; at += MAX_PHOTOS_REMOVED) {
      await request<Ok>('POST', `${splitPath(id)}/attachments/remove`, {
        ids: attachmentIds.slice(at, at + MAX_PHOTOS_REMOVED),
      } satisfies RemovePhotosBody);
    }
  },
  setSplitPicture: (id: string, picture: Blob) =>
    upload<SplitPictureResult>('PUT', `${splitPath(id)}/picture`, picture),
  deleteSplitPicture: (id: string) => request<Ok>('DELETE', `${splitPath(id)}/picture`),
  deleteSplit: (id: string) => request<Ok>('DELETE', splitPath(id)),
  resetShareLinks: (id: string) => request<ShareTokenResult>('POST', `${splitPath(id)}/invite`),
  removeMember: (id: string, email: string) =>
    request<Ok>('DELETE', `${splitPath(id)}/members/${encodeURIComponent(email)}`),
  revokeInvite: (id: string, inviteId: string) =>
    request<Ok>('DELETE', `${splitPath(id)}/invites/${encodeURIComponent(inviteId)}`),
  listInvites: () => request<InviteList>('GET', '/api/invites'),
  acceptInvite: (inviteId: string) =>
    request<AcceptResult>('POST', `/api/invites/${encodeURIComponent(inviteId)}/accept`),
  declineInvite: (inviteId: string) =>
    request<Ok>('POST', `/api/invites/${encodeURIComponent(inviteId)}/decline`),
  /**
   * The rate to convert `from` into `to`, for previews: today's, or with `at` the one for
   * an item paid then. The server converts again on save.
   */
  getRate: (
    from: string,
    to: string,
    { fresh = false, at }: { fresh?: boolean; at?: number } = {},
  ) =>
    request<RateQuote>(
      'GET',
      `/api/rates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${
        fresh ? '&fresh=1' : ''
      }${at != null ? `&at=${at}` : ''}`,
    ),
  /** The other currencies in your splits, with today's rate into `to` (Settings) */
  listUsedCurrencyRates: (to: string) =>
    request<UsedCurrencyRates>('GET', `/api/me/rates?to=${encodeURIComponent(to)}`),
  /** Opening a share link: you're in the split already, have an invite, or asked to join */
  joinSplit: (token: string) =>
    request<JoinResult>('POST', `/api/join/${encodeURIComponent(token)}`),
};

export const attachmentUrl = (splitId: string, attachmentId: string) =>
  `${splitPath(splitId)}/attachments/${encodeURIComponent(attachmentId)}`;

export const splitPictureUrl = (splitId: string, version: number) =>
  `${splitPath(splitId)}/picture?v=${version}`;

export const paymentQrUrl = (methodId: string, version: number) =>
  `/api/payment-qr/${encodeURIComponent(methodId)}?v=${version}`;

export const avatarUrl = (email: string, version: number) =>
  `/api/avatars/${encodeURIComponent(email)}?v=${version}`;

export const inviteUrl = (token: string) =>
  `${window.location.origin}/?join=${encodeURIComponent(token)}`;
