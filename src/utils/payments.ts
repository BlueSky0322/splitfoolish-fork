import { BANK_TRANSFER, type PaymentMethod } from '../../shared/payments';

// How a payment method reads on screen

/** What to call it: the bank for a bank transfer that names one, else its type */
export const methodName = (m: PaymentMethod) =>
  m.type === BANK_TRANSFER && m.bank ? m.bank : m.type;

/** Its details on one line: "Maybank · 5140 1234 5678 · Ben Lim" */
export const methodLine = (m: PaymentMethod) =>
  [m.type === BANK_TRANSFER ? m.bank : null, m.detail, m.accountName]
    .filter((part) => part != null && part !== '')
    .join(' · ');
