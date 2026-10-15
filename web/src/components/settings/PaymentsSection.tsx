import { notifications } from '@mantine/notifications';
import { PaymentMethod, api } from '../../api';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import PayHint from './PayHint';
import PaymentMethods from './PaymentMethods';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';

// Getting paid (9b): how people who owe you can pay, and how that looks to them
const PaymentsSection = ({ track }: { track: Track }) => {
  const { profile, patch } = useProfile();
  if (profile == null) return null;

  // Shown straight away; put back if the server refuses it
  const save = (methods: PaymentMethod[], preferredId: string | null) => {
    const before = {
      paymentMethods: profile.paymentMethods,
      preferredPaymentMethodId: profile.preferredPaymentMethodId,
    };
    patch((p) => ({ ...p, paymentMethods: methods, preferredPaymentMethodId: preferredId }));
    track(api.setPaymentMethods(methods, preferredId)).catch((err: unknown) => {
      patch((p) => ({ ...p, ...before }));
      notifications.show({
        color: 'red',
        message: err instanceof Error ? err.message : 'Could not save your payment methods',
      });
    });
    return Promise.resolve(true);
  };

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
          grouped
          bare
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
            currency={profile.settings.defaultCurrency ?? profile.settings.lastCurrency ?? 'MYR'}
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
