import Skeleton, { Loading } from '../ui/Skeleton';
import classes from './SplitsHome.module.css';
import mobile from './MobileHome.module.css';

// What My splits and Invites show until they load: the shapes of the cards and rows
// that will take their place, so nothing jumps when they arrive.

const LABEL = 'Loading your splits';

/** Desktop: split cards */
export const SplitCardsSkeleton = () => (
  <Loading
    label={LABEL}
    className={classes.grid}
  >
    {[0, 1, 2, 3].map((i) => (
      <div
        key={i}
        className={`sf-card ${classes.splitCard}`}
      >
        <div className={classes.cardTop}>
          <Skeleton
            circle
            width={40}
            height={40}
          />
          <Skeleton
            width="45%"
            height={16}
            style={{ alignSelf: 'center', marginRight: 'auto' }}
          />
          <Skeleton
            width={48}
            height={20}
          />
        </div>
        <div className={classes.cardBottom}>
          <Skeleton
            width={120}
            height={12}
          />
          <Skeleton
            width={70}
            height={18}
          />
        </div>
      </div>
    ))}
  </Loading>
);

/** Tablets: split rows in a card */
export const SplitRowsSkeleton = () => (
  <Loading
    label={LABEL}
    className={`sf-card ${classes.list}`}
  >
    {[0, 1, 2, 3].map((i) => (
      <div
        key={i}
        className={classes.splitRow}
      >
        <Skeleton
          circle
          width={36}
          height={36}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton
            width="40%"
            height={14}
          />
          <Skeleton
            width="60%"
            height={10}
          />
        </div>
        <Skeleton
          width={60}
          height={16}
        />
      </div>
    ))}
  </Loading>
);

/** Phones: split rows running edge to edge */
export const MobileSplitRowsSkeleton = () => (
  <Loading
    label={LABEL}
    className={mobile.list}
  >
    {[0, 1, 2, 3, 4].map((i) => (
      <div
        key={i}
        className={mobile.row}
      >
        <Skeleton
          circle
          width={44}
          height={44}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton
            width="50%"
            height={15}
          />
          <Skeleton
            width="35%"
            height={11}
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton
            width={56}
            height={15}
          />
          <Skeleton
            width={28}
            height={10}
          />
        </div>
      </div>
    ))}
  </Loading>
);

/** Invites: a couple of rows, on a phone with the split's picture */
export const InviteRowsSkeleton = ({ phone }: { phone?: boolean }) => (
  <Loading
    label="Loading your invites"
    className={phone ? mobile.group : `sf-card ${classes.list}`}
  >
    {[0, 1].map((i) => (
      <div
        key={i}
        className={phone ? mobile.inviteRow : classes.inviteRow}
      >
        {phone && (
          <Skeleton
            circle
            width={44}
            height={44}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton
            width="45%"
            height={14}
          />
          <Skeleton
            width="65%"
            height={10}
          />
        </div>
        <Skeleton
          width={phone ? 96 : 84}
          height={phone ? 44 : 36}
          radius={phone ? 22 : 8}
        />
      </div>
    ))}
  </Loading>
);
