import { showUndo } from '../../common/undo-toast';
import type { SplitActions } from '../../../split/actions';
import type { SplitPayment } from '../../../split/state';
import { toApiPayment } from '../../../split/state';

/** Deletes a payment at once, with Undo to put it back */
export function deletePayment(actions: SplitActions, payment: SplitPayment) {
  if (!actions.removePayment(payment.id)) return;
  const saved = toApiPayment(payment);
  showUndo('Deleted payment', () => actions.restorePayment(saved));
}
