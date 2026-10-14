// Ways people get paid back. The type is picked from a fixed list (or Other, named
// freely); a bank transfer also names the bank, which can be any bank.

export const BANK_TRANSFER = 'Bank transfer';
export const CASH = 'Cash';

/** The types offered when adding a method; anything else is shown as Other */
export const PAYMENT_TYPES = [
  'DuitNow',
  BANK_TRANSFER,
  "Touch 'n Go eWallet",
  'PayNow',
  'PayPal',
  CASH,
] as const;

/** Suggested when naming the bank; any other bank can be typed in */
export const COMMON_BANKS = [
  'Maybank',
  'CIMB',
  'Public Bank',
  'RHB',
  'Hong Leong Bank',
  'AmBank',
  'Bank Islam',
  'Bank Rakyat',
  'BSN',
  'Alliance Bank',
  'Affin Bank',
  'UOB',
  'OCBC',
  'HSBC',
  'Standard Chartered',
  'GXBank',
  'AEON Bank',
  'Boost Bank',
  'DBS',
  'POSB',
] as const;

export const MAX_METHOD_TYPE = 32;
export const MAX_METHOD_DETAIL = 120;
export const MAX_BANK = 40;
export const MAX_ACCOUNT_NAME = 80;

export interface PaymentMethod {
  id: string;
  type: string;
  /** The number, ID, email or link to pay to; for a bank transfer, the account number */
  detail: string;
  /** Bank transfers only */
  bank?: string | null;
  accountName?: string | null;
}

/** Cash needs nothing written down; every other type needs its details */
export const needsDetail = (type: string) => type !== CASH;
