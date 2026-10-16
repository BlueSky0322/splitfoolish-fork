import Skeleton, { Loading } from '../../ui/Skeleton';
import items from '../items/ItemViews.module.css';
import page from '../Split.module.css';

// What the split page shows until the split loads: the shapes of its title, balance
// and items, so the page keeps its layout instead of filling in piece by piece.

/** The split's picture and name */
export const TitleSkeleton = ({ size }: { size: number }) => (
  <>
    <Skeleton
      circle
      width={size}
      height={size}
    />
    <Skeleton
      width={size > 36 ? 200 : 140}
      height={Math.round(size * 0.5)}
    />
  </>
);

/** Where you stand: a label over a large amount */
export const HeroSkeleton = ({ size }: { size: number }) => (
  <div className="flex flex-col gap-1">
    <Skeleton
      width={90}
      height={11}
      style={{ margin: '4px 0' }}
    />
    <Skeleton
      width={Math.round(size * 3.6)}
      height={Math.round(size * 0.85)}
      style={{ margin: `${Math.round(size * 0.13)}px 0` }}
    />
  </div>
);

/** Who pays who, the routing choice and Share as image, below the amount */
export const PanelSkeleton = () => (
  <>
    <div className="flex flex-col gap-3">
      <Skeleton
        width={80}
        height={10}
      />
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2"
        >
          <Skeleton
            circle
            width={24}
            height={24}
          />
          <Skeleton
            height={12}
            style={{ flex: 1 }}
          />
          <Skeleton
            width={56}
            height={14}
          />
        </div>
      ))}
    </div>
    <Skeleton
      height={36}
      radius={8}
    />
  </>
);

/** A day's worth of item rows, as cards on a computer or rows with a tile on a phone */
export const ItemsSkeleton = ({ mobile }: { mobile: boolean }) => (
  <Loading
    label="Loading the split"
    className={`${items.groups} ${mobile ? items.mobile : ''}`}
  >
    <section className={items.group}>
      <div className={items.groupHeader}>
        <Skeleton
          width={70}
          height={10}
          style={{ margin: '4px 0' }}
        />
        <Skeleton
          width={50}
          height={10}
          style={{ margin: '4px 0' }}
        />
      </div>
      <div className={items.itemCard}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={items.itemRow}
          >
            {mobile && (
              <Skeleton
                width={36}
                height={36}
                radius={10}
              />
            )}
            <div
              className={`${items.itemText} flex flex-col justify-center gap-2`}
              style={{ minHeight: 41 }}
            >
              <Skeleton
                width={`${40 - (i % 3) * 8}%`}
                height={13}
              />
              <Skeleton
                width={`${mobile ? 35 : 55}%`}
                height={10}
              />
            </div>
            <Skeleton
              width={52}
              height={14}
            />
          </div>
        ))}
      </div>
    </section>
  </Loading>
);

/** Grouping, sorting and the view toggle above the items */
export const ToolbarSkeleton = () => (
  <div className={page.toolbar}>
    {[84, 84].map((width, i) => (
      <Skeleton
        key={i}
        width={width}
        height={30}
        radius={15}
        style={{ margin: '2px 0' }}
      />
    ))}
    <span className="flex-1" />
    <Skeleton
      width={64}
      height={30}
      radius={8}
      style={{ margin: '2px 0' }}
    />
  </div>
);
