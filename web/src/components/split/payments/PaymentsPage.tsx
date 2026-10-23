import { Button, UnstyledButton } from '@mantine/core';
import { CaretLeft, HandCoins } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { toCents } from '@shared/rates';
import { goUp, splitAddress } from '../../../hooks/useRoute';
import { dayKey, dayLabel } from '../../../split/grouping';
import type { SplitPayment } from '../../../split/state';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitActions } from '../../../split/useSplit';
import { formatMoney } from '../../../utils/money';
import { plural } from '../../../utils/text';
import { useSplitPage } from '../SplitPageContext';
import { deletePayment } from './delete-payment';
import { PaymentRow } from './PaymentRow';
import classes from './Payments.module.css';

/** Payments newest first, in groups by the day they were paid */
function byDay(payments: SplitPayment[]) {
  const days = new Map<string, { label: string; payments: SplitPayment[] }>();
  for (const p of [...payments].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = dayKey(p.createdAt);
    const day = days.get(key) ?? { label: dayLabel(p.createdAt), payments: [] };
    day.payments.push(p);
    days.set(key, day);
  }
  return [...days.entries()];
}

/**
 * The split's payments, every one: who paid whom back and when, by day, with Edit and
 * Delete, and a way to record another. Opened from the split's menu and from Settle up.
 */
const PaymentsPage = ({ dialogs }: { dialogs: ReactNode }) => {
  const { splitId, meta, currency, openDialog } = useSplitPage();
  const { payments } = useSplitState().state;
  const actions = useSplitActions();
  const totalCents = payments.reduce((sum, p) => sum + toCents(p.amount), 0);

  return (
    <div className={classes.page}>
      <div className={classes.head}>
        <UnstyledButton
          className={classes.back}
          onClick={() => goUp(splitAddress(splitId))}
          aria-label={`Back to ${meta?.name ?? 'the split'}`}
        >
          <CaretLeft size={20} />
          <span>{meta?.name ?? 'Back'}</span>
        </UnstyledButton>
        <span className="flex-1" />
        <Button
          leftSection={<HandCoins size={16} />}
          onClick={() => openDialog({ kind: 'payment' })}
          disabled={meta == null}
        >
          Record payment
        </Button>
      </div>
      <div>
        <h1 className={classes.title}>Payments</h1>
        <div className={classes.summary}>
          {payments.length === 0
            ? 'Who paid whom back, as it happens'
            : `${plural(payments.length, 'payment')}, ${formatMoney(totalCents, currency)} paid back in all`}
        </div>
      </div>
      {payments.length === 0 ? (
        <div className={classes.empty}>
          No payments yet. When someone pays another back, mark the transfer as paid in Settle up,
          or record it here.
        </div>
      ) : (
        byDay(payments).map(([key, day]) => (
          <section
            key={key}
            className={classes.day}
          >
            <h6 className="sf-label">{day.label}</h6>
            {day.payments.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                currency={currency}
                onEdit={() => openDialog({ kind: 'payment', payment: p })}
                onDelete={() => deletePayment(actions, p)}
              />
            ))}
          </section>
        ))
      )}
      {dialogs}
    </div>
  );
};

export default PaymentsPage;
