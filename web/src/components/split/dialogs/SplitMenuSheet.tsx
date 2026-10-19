import { UnstyledButton } from '@mantine/core';
import {
  ArrowsLeftRight,
  CaretRight,
  Export,
  GearSix,
  ShareNetwork,
  UsersThree,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { canManageInvites } from '@shared/rules';
import { otherCurrencies } from '../../../split/derive';
import { useSplitState } from '../../../split/SplitStateContext';
import { plural } from '../../../utils/text';
import SplitAvatar from '../../common/SplitAvatar';
import { AvatarStack } from '../layout/SplitPageParts';
import { useSplitPage } from '../SplitPageContext';
import classes from './SplitMenuSheet.module.css';

const Row = ({
  icon,
  title,
  detail,
  end,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  end?: ReactNode;
  onClick: () => void;
}) => (
  <UnstyledButton
    className={classes.row}
    onClick={onClick}
  >
    <span className={classes.tile}>{icon}</span>
    <span className="min-w-0 flex-1">
      <span className={classes.title}>{title}</span>
      <span className={classes.detail}>{detail}</span>
    </span>
    {end}
    <CaretRight
      size={16}
      className="sf-muted"
    />
  </UnstyledButton>
);

/** "You, Mei, Ben and 2 others" */
function peopleLine(names: string[]) {
  if (names.length === 0) return 'Nobody added yet';
  if (names.length <= 3) return names.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `${names.slice(0, 3).join(', ')} and ${plural(names.length - 3, 'other')}`;
}

// The split's menu on a phone: who's in it, sharing, currencies, exporting, then its
// settings. Photos aren't here; they're a tab of the split.
const SplitMenuSheet = () => {
  const { splitId, meta, me, currency, pictureVersion, openDialog } = useSplitPage();
  const { people, items } = useSplitState().state;
  if (meta == null) return null;
  const names = [
    ...(me ? ['You'] : []),
    ...people.filter((p) => p.id !== me?.id).map((p) => p.name),
  ];
  const others = otherCurrencies(items);
  const asking = canManageInvites(meta.role)
    ? (meta.invites ?? []).filter((i) => i.needsApproval).length
    : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className={classes.head}>
        <SplitAvatar
          splitId={splitId}
          name={meta.name}
          pictureVersion={pictureVersion}
          size={44}
          preview
        />
        <span className="min-w-0 flex-1">
          <span className={classes.name}>{meta.name}</span>
          <span className={classes.detail}>
            {plural(people.length, 'person', 'people')}, {plural(items.length, 'item')}, in{' '}
            {currency}
          </span>
        </span>
      </div>
      <div className={classes.group}>
        <Row
          icon={<UsersThree size={20} />}
          title="People"
          detail={peopleLine(names)}
          end={
            people.length > 0 ? (
              <AvatarStack
                people={people}
                size={24}
                max={3}
              />
            ) : null
          }
          onClick={() => openDialog({ kind: 'people' })}
        />
        <Row
          icon={<ShareNetwork size={20} />}
          title="Share split"
          detail={asking > 0 ? `Invite link, ${asking} asking to join` : 'Invite link'}
          end={asking > 0 ? <span className="sf-count-badge">{asking}</span> : null}
          onClick={() => openDialog({ kind: 'members' })}
        />
        <Row
          icon={<ArrowsLeftRight size={20} />}
          title="Currencies"
          detail={
            others.length > 0
              ? `${others.join(', ').replace(/, ([^,]*)$/, ' and $1')}, converted to ${currency}`
              : `Everything is in ${currency} so far`
          }
          onClick={() => openDialog({ kind: 'currencies' })}
        />
        <Row
          icon={<Export size={20} />}
          title="Export"
          detail={
            meta.converting
              ? `Once amounts are converted to ${currency}`
              : 'CSV for spreadsheets, or PDF'
          }
          onClick={() => openDialog({ kind: 'export' })}
        />
      </div>
      <div className={classes.group}>
        <Row
          icon={<GearSix size={20} />}
          title="Split settings"
          detail="Name, picture, currency, delete"
          onClick={() => openDialog({ kind: 'settings' })}
        />
      </div>
    </div>
  );
};

export default SplitMenuSheet;
