import { api } from '../../api';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import PayHint from './PayHint';
import PaymentMethods from './PaymentMethods';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';
import type { PaymentMethod } from '@shared/payments';
import { showError } from '../../utils/notify';
import { homeCurrency } from '../../utils/money';

// Getting paid: how people who owe you can pay, and how that looks to them
const PaymentsSection = ({ track }: { track: Track }) => {
  const { profile, change } = useProfile();
  if (profile == null) return null;

  // Shown straight away; put back if the server refuses it
  const save = (methods: PaymentMethod[], preferredId: string | null) =>
    void track(
      change(
        (p) => ({ ...p, paymentMethods: methods, preferredPaymentMethodId: preferredId }),
        () => api.setPaymentMethods(methods, preferredId),
      ),
    ).catch((err: unknown) => showError(err, 'Could not save your payment methods'));

  const preferred = profile.paymentMethods.find((m) => m.id === profile.preferredPaymentMethodId);
  const ordered = preferred
    ? [preferred, ...profile.paymentMethods.filter((m) => m !== preferred)]
    : profile.paymentMethods;

  return (
    <>
      <SettingsCard
        title="Payment methods"
        help="The preferred one shows first. The others are listed under it."
        flush
      >
        <PaymentMethods
          methods={profile.paymentMethods}
          preferredId={profile.preferredPaymentMethodId}
          onChange={save}
        />
      </SettingsCard>

      {ordered.length > 0 && (
        <SettingsCard
          title="What people who owe you see"
          help="Next to their transfer to you, in Settle up."
        >
          <PayHint
            name={nameFor(profile.email, profile.displayName)}
            amountCents={10250}
            currency={homeCurrency(profile.settings)}
            methods={ordered}
            email={profile.email}
            avatarVersion={profile.avatarVersion}
          />
        </SettingsCard>
      )}
    </>
  );
};

export default PaymentsSection;
