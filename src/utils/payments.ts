import { BANK_TRANSFER, QR_CODE, type PaymentMethod } from '../../shared/payments';

// How a payment method reads on screen

export const isQr = (m: PaymentMethod) => m.type === QR_CODE;

/** What to call it: a QR code's label, the bank for a bank transfer that names one, else its type */
export const methodName = (m: PaymentMethod) =>
  isQr(m) ? m.detail || QR_CODE : m.type === BANK_TRANSFER && m.bank ? m.bank : m.type;

/** Its details on one line: "Maybank · 5140 1234 5678 · Ben Lim" */
export const methodLine = (m: PaymentMethod) =>
  isQr(m)
    ? QR_CODE
    : [m.type === BANK_TRANSFER ? m.bank : null, m.detail, m.accountName]
        .filter((part) => part != null && part !== '')
        .join(' · ');
