import { ActionIcon, Button, Tooltip } from '@mantine/core';
import { ArrowSquareOut, DownloadSimple, Images, Receipt, Trash } from '@phosphor-icons/react';
import type { Attachment } from '@shared/api';
import { toCents } from '@shared/rates';
import { attachmentUrl } from '../../../api';
import { dayLabel } from '../../../split/grouping';
import { photoFileName } from '../../../split/photo-download';
import { fileLabel } from '../../../split/photo-days';
import type { SplitItem } from '../../../split/state';
import { formatMoney } from '../../../utils/money';
import UserAvatar from '../../common/UserAvatar';
import { useSplitPage } from '../SplitPageContext';
import { timeLabel, useAddedBy } from './added-by';
import classes from './PhotoDetails.module.css';

// About the photo open in the viewer on a computer: who added it and when, and for a
// receipt, its item (what it cost and your part of it), with Download and Remove
const PhotoDetails = ({
  photo,
  item,
  onRemove,
  onOpenItem,
}: {
  photo: Attachment;
  /** The item a receipt belongs to; null for a photo of the split */
  item: SplitItem | null;
  onRemove?: () => void;
  onOpenItem: (item: SplitItem) => void;
}) => {
  const { splitId, meta, currency, me, totals } = useSplitPage();
  const addedBy = useAddedBy()(photo.uploadedBy);
  const added = `${dayLabel(photo.createdAt)}, ${timeLabel(photo.createdAt)}`;
  const myShare = item && me ? totals.sharesByItem.get(item.id)?.get(me.id) ?? 0 : null;

  const avatar = (size: number) => (
    <UserAvatar
      name={addedBy.name}
      email={addedBy.email}
      avatarVersion={addedBy.avatarVersion}
      color={addedBy.color}
      size={size}
      preview={false}
    />
  );

  return (
    <div className={classes.panel}>
      {item ? (
        <>
          <span className={classes.tag}>
            <Receipt size={12} />
            Receipt
          </span>
          <div>
            <h3 className={classes.heading}>{item.name}</h3>
            <div className={classes.sub}>
              {dayLabel(item.createdAt)}, {item.payer.name} paid
            </div>
          </div>
          <dl className={classes.rows}>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(toCents(item.cost), currency)}</dd>
            </div>
            {myShare != null && (
              <div>
                <dt>Your share</dt>
                <dd>{formatMoney(myShare, currency)}</dd>
              </div>
            )}
            <div>
              <dt>Added by</dt>
              <dd className={classes.who}>
                {avatar(20)}
                {addedBy.name}, {timeLabel(photo.createdAt)}
              </dd>
            </div>
          </dl>
          <Button
            variant="default"
            className={classes.button}
            leftSection={<ArrowSquareOut size={16} />}
            onClick={() => onOpenItem(item)}
          >
            Open item
          </Button>
        </>
      ) : (
        <>
          <span className={classes.tag}>
            <Images size={12} />
            Split photo
          </span>
          <div className={classes.addedBy}>
            {avatar(40)}
            <div>
              <div className={classes.name}>Added by {addedBy.name}</div>
              <div className={classes.sub}>{added}</div>
            </div>
          </div>
          <dl className={classes.rows}>
            <div>
              <dt>In</dt>
              <dd>{meta?.name}</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd>{fileLabel(photo)}</dd>
            </div>
          </dl>
        </>
      )}
      <div className={classes.footer}>
        <Button
          component="a"
          href={attachmentUrl(splitId, photo.id)}
          download={photoFileName(photo)}
          variant="default"
          className={classes.button}
          leftSection={<DownloadSimple size={16} />}
          flex={1}
        >
          Download
        </Button>
        {onRemove && (
          <Tooltip label="Remove photo">
            <ActionIcon
              variant="default"
              size={36}
              className={`sf-danger-outline ${classes.remove}`}
              aria-label="Remove photo"
              onClick={onRemove}
            >
              <Trash size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default PhotoDetails;
