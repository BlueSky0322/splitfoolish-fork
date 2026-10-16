// What the API sends back, in one place: the Worker builds these and the app reads
// them, so a field changed on one side fails to compile on the other. The split's bill
// itself (people, items, changes) is in types.ts.

import type { PaymentMethod } from './payments';
import type { RateSource } from './rates';
import type { Change, Item, Person, Role } from './types';

// ---------- Account ----------

export const THEMES = ['dark', 'light', 'auto'] as const;
export const ACCENTS = ['blurple', 'blue', 'teal', 'green', 'amber', 'rose'] as const;
/** Where an account's exchange rates come from first (see RATE_PROVIDERS) */
export const RATE_PREFERENCES = ['wise', 'ecb'] as const;
export const ITEMS_VIEWS = ['card', 'table'] as const;
export const ITEMS_GROUPS = ['none', 'day', 'payer', 'category'] as const;
export const ITEMS_SORT_KEYS = ['date', 'name', 'payer', 'amount'] as const;
export const SORT_DIRS = ['asc', 'desc'] as const;

export type ThemeSetting = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type RatePreference = (typeof RATE_PREFERENCES)[number];

/** The longest display name an account can have */
export const MAX_DISPLAY_NAME = 32;

/** Private preferences that follow the account between devices */
export interface Settings {
  theme: ThemeSetting;
  accent: Accent;
  /** The currency the last new split used */
  lastCurrency: string | null;
  /** A fixed currency for new splits; null to use the last one */
  defaultCurrency: string | null;
  ratePreference: RatePreference;
  sidebarOpen: boolean;
  itemsView: (typeof ITEMS_VIEWS)[number];
  itemsGroupBy: (typeof ITEMS_GROUPS)[number];
  itemsSortKey: (typeof ITEMS_SORT_KEYS)[number];
  itemsSortDir: (typeof SORT_DIRS)[number];
}

/** Settings before anyone changes them */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  accent: 'blurple',
  lastCurrency: null,
  defaultCurrency: null,
  ratePreference: 'wise',
  sidebarOpen: true,
  itemsView: 'card',
  itemsGroupBy: 'day',
  itemsSortKey: 'date',
  // Newest items first
  itemsSortDir: 'desc',
};

/** The signed-in account: what others see of it, and its private settings */
export interface Profile {
  email: string;
  displayName: string | null;
  avatarVersion: number | null;
  paymentMethods: PaymentMethod[];
  preferredPaymentMethodId: string | null;
  settings: Settings;
}

export interface ProfilePatch {
  displayName?: string | null;
  settings?: Partial<Settings>;
}

// ---------- Splits ----------

/** A split in My splits */
export interface SplitSummary {
  id: string;
  name: string;
  currency: string;
  role: Role;
  memberCount: number;
  peopleCount: number;
  itemCount: number;
  totalCents: number;
  /** Something was spent and everyone's square */
  settled: boolean;
  /** Archived by this account: out of its Active list, still theirs */
  archived: boolean;
  /** Null when no one in the split is linked to this account */
  myBalanceCents: number | null;
  /** Null when the split has no picture */
  pictureVersion: number | null;
  updatedAt: number;
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

/** An invite or request to join a split, as its owner sees it */
export interface SplitInvite {
  id: string;
  email: string;
  /** Whose link they opened */
  invitedBy: string;
  invitedByName: string | null;
  /** Opened a member's link: waiting for the owner to approve */
  needsApproval: boolean;
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
  converting: boolean;
  role: Role;
  members: SplitMember[];
  /** Invites and requests to join not yet answered; only sent to the owner */
  invites?: SplitInvite[];
  /** Your share link: the owner's lets people in, a member's asks the owner first */
  shareToken?: string;
  attachments: Attachment[];
  people: Person[];
  items: Item[];
}

/** An item name used in your splits, for suggestions */
export interface ItemNameUse {
  name: string;
  /** The category it was given last */
  category: string | null;
  uses: number;
}

// ---------- Invites ----------

interface InviteBase {
  id: string;
  splitId: string;
  splitName: string;
  /** Whose link it came from */
  invitedBy: string;
  /** Their display name, if they set one */
  invitedByName: string | null;
  createdAt: number;
  expiresAt: number;
}

/**
 * invite: to you, to accept or decline. sent: you asked to join through a member's
 * link, waiting for the owner. request: someone asked to join your split.
 */
export type MyInvite =
  | (InviteBase & { kind: 'invite' })
  | (InviteBase & { kind: 'sent'; owner: string; ownerName: string | null })
  | (InviteBase & { kind: 'request'; email: string; name: string | null });

/** Opening a share link: you're in the split already, have an invite, or asked to join */
export type JoinResult =
  | { status: 'member'; id: string }
  | { status: 'invited' | 'requested'; id: string; inviteId: string };

// ---------- Rates ----------

/** A fetched rate (never a typed one) */
export type FetchedRateSource = Exclude<RateSource, 'manual'>;

/** The service each rate preference stands for: the ECB's rates come from Frankfurter */
export const RATE_PROVIDERS: Record<RatePreference, FetchedRateSource> = {
  wise: 'wise',
  ecb: 'frankfurter',
};

/** GET /api/rates: one currency into another */
export interface RateQuote {
  from: string;
  to: string;
  rate: number;
  source: FetchedRateSource;
  fetchedAt: number;
  /** The amount asked about (?amount=), converted */
  convertedCents?: number;
}

/** Another currency in your splits, with today's rate into the one asked for */
export interface UsedCurrencyRate {
  currency: string;
  /** How many of your splits use it */
  splits: number;
  /** Null when no rate could be had right now */
  rate: number | null;
  source: FetchedRateSource | null;
  fetchedAt: number | null;
}

export interface UsedCurrencyRates {
  to: string;
  currencies: UsedCurrencyRate[];
}

// ---------- Photos ----------
// The largest upload the server stores; the app shrinks photos to fit before sending.
// D1 allows up to 2 MB per value, and shrunk photos are usually a few hundred KB.

export const MAX_PHOTO_BYTES = 1_500_000;
/** Profile and split pictures */
export const MAX_AVATAR_BYTES = 256_000;
/** A QR code is shrunk to about 1000px, sharp enough to scan from another phone */
export const MAX_QR_BYTES = 512_000;

// ---------- Live updates ----------

/** The header a request names its tab in, so the tab can skip news of its own change */
/**
 * The most changes one request may carry. The app sends a longer queue in several
 * requests, in order. public/sw.js keeps its own copy (sw.test.ts checks they agree).
 */
export const MAX_CHANGES = 200;

export const CLIENT_ID_HEADER = 'X-Client-Id';

/** A row the app makes before it's saved (a person, item, payment method): 16 hex characters */
export const ROW_ID_CHARS = '[0-9a-f]{16}';
const ROW_ID_PATTERN = new RegExp(`^${ROW_ID_CHARS}$`);
export const isRowId = (v: unknown): v is string => typeof v === 'string' && ROW_ID_PATTERN.test(v);

/** Sent by the app to keep a quiet live-update socket open, and the room's answer */
export const LIVE_PING = 'ping';
export const LIVE_PONG = 'pong';
/** The room's close code for someone taken out of the split, so the app stops reconnecting */
export const LIVE_REMOVED_CODE = 4403;

/** What a split's room sends: it changed, and which tab changed it (that tab ignores it) */
export interface RoomMessage {
  type: 'changed';
  by: string | null;
}

// ---------- Writes ----------

/** What a change that returns nothing else sends back */
export interface Ok {
  ok: true;
}

/** What every refused or failed request sends back */
export interface ApiErrorBody {
  error: string;
}

// ---------- Request bodies ----------
// What the app sends. The server reads each field by these names and still checks its
// value, so a renamed field fails to compile on both sides.

/** POST /splits. The id is made by the app, so the split can open before this lands. */
export interface CreateSplitBody {
  id: string;
  name: string;
  currency: string;
}

/** PUT /splits/order: every split id, first to last */
export interface SplitOrderBody {
  ids: string[];
}

/** PUT /archived: archives a split for you, or brings it back */
export interface ArchiveBody {
  id: string;
  archived: boolean;
}

/** PATCH /splits/:id */
export interface SplitPatch {
  name?: string;
  currency?: string;
}

/** POST /splits/:id/changes */
export interface ChangesBody {
  changes: Change[];
}

/** PUT /me/payment-methods: all of them, and which is preferred */
export interface PaymentMethodsBody {
  methods: PaymentMethod[];
  preferredId: string | null;
}

// ---------- Lists ----------

/** GET /splits */
export interface SplitList {
  splits: SplitSummary[];
}

/** An item found by GET /search, with the split it's in */
export interface FoundItem {
  id: string;
  name: string;
  costCents: number;
  category: string | null;
  createdAt: number;
  splitId: string;
  splitName: string;
  /** The split's */
  currency: string;
}

/** GET /search?q= */
export interface SearchResult {
  items: FoundItem[];
}

/** GET /item-names */
export interface ItemNames {
  names: ItemNameUse[];
}

/** GET /invites */
export interface InviteList {
  invites: MyInvite[];
}

/** POST /splits: the new split's id */
export interface Created {
  id: string;
}

/** Accepting an invite, or approving a request to join: the split it's for */
export interface AcceptResult {
  id: string;
}

/** PATCH /splits/:id. converting: its items are being converted to a new currency */
export interface UpdateSplitResult extends Ok {
  converting: boolean;
}

/** A new share link */
export interface ShareTokenResult {
  shareToken: string;
}

/** A new picture's version, for its address */
export interface AvatarResult {
  avatarVersion: number;
}
export interface SplitPictureResult {
  pictureVersion: number;
}
export interface PaymentQrResult {
  qrVersion: number;
}
