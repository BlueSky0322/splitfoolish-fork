import { SegmentedControl, UnstyledButton } from '@mantine/core';
import { toCents } from '@shared/rates';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useState } from 'react';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import { dayLabel } from '../../../split/grouping';
import { useSplitState } from '../../../split/SplitStateContext';
import {
  REST,
  byCategory,
  byPayer,
  byShare,
  crossCut,
  foldTail,
  percentOf,
} from '../../../split/spending';
import type { Slice } from '../../../split/spending';
import type { SplitItem } from '../../../split/state';
import { categoryLabel } from '../../../split/categories';
import { formatAmount, formatMoney } from '../../../utils/money';
import { plural } from '../../../utils/text';
import { usePersonColors } from '../person-colors-context';
import { useSplitPage } from '../SplitPageContext';
import { RING_INNER, RING_OUTER, RING_SIZE, arcsOf, categoryColor, sector } from './ring';
import classes from './Spending.module.css';

type View = 'categories' | 'paid' | 'shares';

const VIEWS: { value: View; label: string }[] = [
  { value: 'categories', label: 'Categories' },
  { value: 'paid', label: 'Paid by' },
  { value: 'shares', label: 'Shares' },
];

/** How many of a slice's items its details list before "Show all" */
const FIRST_ITEMS = 6;

/**
 * A picked slice in detail: the same money cut the other way (a category by who paid,
 * a person by category), then its items largest first, each opening the item
 */
function SliceDetails({
  slice,
  view,
  items,
  currency,
  onOpen,
}: {
  slice: Slice;
  view: View;
  items: SplitItem[];
  currency: string;
  onOpen: (item: SplitItem) => void;
}) {
  const [all, setAll] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i]));
  const cut = crossCut(slice, view === 'categories' ? 'payer' : 'category', items);
  const shown = all ? slice.parts : slice.parts.slice(0, FIRST_ITEMS);
  return (
    <div
      className={classes.details}
      role="region"
      aria-label={`${slice.label} in detail`}
    >
      {cut.length > 1 || view !== 'categories' ? (
        <div className={classes.cut}>
          <span className={classes.cutLabel}>
            {view === 'categories' ? 'Paid by' : 'By category'}
          </span>
          {cut.map((c) => (
            <span
              key={c.key}
              className={classes.cutChip}
            >
              {c.label} <span className={classes.cutAmount}>{formatMoney(c.cents, currency)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className={classes.cut}>
          <span className={classes.cutLabel}>All paid by {cut[0]?.label}</span>
        </div>
      )}
      <ul
        className={classes.parts}
        aria-label={`${slice.label} items`}
      >
        {shown.map((part) => {
          const item = byId.get(part.itemId);
          if (item == null) return null;
          // The folded categories and the people's views say which category each is
          const sub = [
            dayLabel(item.createdAt),
            (slice.key === REST || view !== 'categories') && categoryLabel(item.category),
            view === 'shares' &&
              part.cents !== toCents(item.cost) &&
              `of ${formatMoney(toCents(item.cost), currency)}`,
          ].filter(Boolean);
          return (
            <li key={part.itemId}>
              <UnstyledButton
                className={classes.part}
                onClick={() => onOpen(item)}
              >
                <span className={classes.partText}>
                  <span className={classes.partName}>{item.name}</span>
                  <span className={classes.partSub}>{sub.join(' · ')}</span>
                </span>
                <span className={classes.partAmount}>{formatMoney(part.cents, currency)}</span>
              </UnstyledButton>
            </li>
          );
        })}
      </ul>
      {slice.parts.length > FIRST_ITEMS && (
        <UnstyledButton
          className={classes.more}
          onClick={() => setAll((on) => !on)}
        >
          {all ? 'Show fewer' : `Show all ${plural(slice.parts.length, 'item')}`}
        </UnstyledButton>
      )}
    </div>
  );
}

/**
 * Where the money went: a ring of the biggest slices with the total in the middle, and
 * every slice as a row with a bar, its amount and its share. By category, by who paid,
 * or by whose share it was. Hovering a slice or row shows it in the middle; tapping one
 * holds it there and opens it in detail under its row.
 */
const Spending = () => {
  const { totals, currency, openDialog } = useSplitPage();
  const { people, items } = useSplitState().state;
  const isMobile = useIsMobile();
  const colorOf = usePersonColors();
  const [view, setView] = useState<View>('categories');
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const slices: Slice[] =
    view === 'categories'
      ? foldTail(byCategory(items))
      : view === 'paid'
        ? byPayer(items, people)
        : byShare(items, people, totals);
  const total = slices.reduce((sum, s) => sum + s.cents, 0);
  const colored = slices.map((s, i) => ({
    ...s,
    color:
      view === 'categories'
        ? categoryColor(s.key, i)
        : colorOf({ personId: s.key })?.fill ?? 'var(--sf-series-rest)',
  }));
  const focusKey = hovered ?? picked;
  const focused = colored.find((s) => s.key === focusKey) ?? null;
  const max = Math.max(1, ...slices.map((s) => s.cents));

  const change = (next: View) => {
    setView(next);
    setPicked(null);
    setHovered(null);
  };
  const toggle = (key: string) => setPicked((now) => (now === key ? null : key));
  // Previews follow a mouse only: a tap on a phone mustn't leave a slice "hovered" over
  // the one picked
  const hover = (key: string) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setHovered(key);
  };
  const unhover = () => setHovered(null);
  const onKey = (e: KeyboardEvent, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(key);
    }
  };
  // As the items list opens one: the item on phones, the form elsewhere
  const open = (item: SplitItem) =>
    openDialog(isMobile ? { kind: 'item', itemId: item.id } : { kind: 'edit', item });
  const describe = (s: Slice) =>
    `${s.label}, ${formatMoney(s.cents, currency)}, ${percentOf(s.cents, total)}%`;

  const arcs = arcsOf(colored);
  const sliceProps = (s: (typeof arcs)[number]) => ({
    'className': classes.slice,
    'data-dim': focusKey != null && focusKey !== s.key ? '' : undefined,
    'role': 'button',
    'tabIndex': 0,
    'aria-label': describe(s),
    'aria-pressed': picked === s.key,
    'onClick': () => toggle(s.key),
    'onKeyDown': (e: KeyboardEvent) => onKey(e, s.key),
    'onPointerEnter': hover(s.key),
    'onPointerLeave': unhover,
    'onFocus': () => setHovered(s.key),
    'onBlur': unhover,
  });

  return (
    <div className={classes.spending}>
      <SegmentedControl
        fullWidth
        size="xs"
        data={VIEWS}
        value={view}
        onChange={(v) => change(v as View)}
        aria-label="Spending by"
      />
      <div className={classes.chart}>
        <div className={classes.ringWrap}>
          <svg
            className={classes.ring}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            width={RING_SIZE}
            height={RING_SIZE}
            role="group"
            aria-label={`Spending by ${VIEWS.find((v) => v.value === view)!.label.toLowerCase()}`}
          >
            {arcs.length === 1 ? (
              <circle
                {...sliceProps(arcs[0])}
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={(RING_OUTER + RING_INNER) / 2}
                fill="none"
                stroke={arcs[0].color}
                strokeWidth={RING_OUTER - RING_INNER}
              />
            ) : (
              arcs.map((s) => (
                <path
                  key={s.key}
                  {...sliceProps(s)}
                  d={sector(s.from, s.to)}
                  fill={s.color}
                />
              ))
            )}
          </svg>
          {/* What the middle shows: the whole, or the slice in hand. A long name
              shortens with "…" inside the ring rather than running over it */}
          <div
            className={classes.centre}
            role="status"
          >
            <span className={classes.centreValue}>
              {formatAmount(focused?.cents ?? total, currency)}
            </span>
            {focused ? (
              <>
                <span
                  className={classes.centreLabel}
                  title={focused.label}
                >
                  {focused.label}
                </span>
                <span className={classes.centreSub}>{percentOf(focused.cents, total)}%</span>
              </>
            ) : (
              <span className={classes.centreSub}>
                {currency} · {plural(items.length, 'item')}
              </span>
            )}
          </div>
        </div>
        <div
          className={classes.rows}
          role="group"
          aria-label="Slices"
        >
          {colored.map((s) => (
            <div
              key={s.key}
              className={classes.rowWrap}
              data-open={picked === s.key ? '' : undefined}
            >
              <button
                type="button"
                className={classes.row}
                aria-label={describe(s)}
                aria-pressed={picked === s.key}
                aria-expanded={picked === s.key}
                data-dim={focusKey != null && focusKey !== s.key ? '' : undefined}
                onClick={() => toggle(s.key)}
                onPointerEnter={hover(s.key)}
                onPointerLeave={unhover}
              >
                <span
                  className={classes.swatch}
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className={classes.rowLabel}>{s.label}</span>
                <span className={classes.rowAmount}>{formatMoney(s.cents, currency)}</span>
                <span className={classes.rowShare}>{percentOf(s.cents, total)}%</span>
                <span
                  className={classes.rowTrack}
                  aria-hidden
                >
                  <span
                    className={classes.rowBar}
                    style={{ width: `${(s.cents / max) * 100}%`, background: s.color }}
                  />
                </span>
              </button>
              {picked === s.key && (
                <SliceDetails
                  key={`${view}-${s.key}`}
                  slice={s}
                  view={view}
                  items={items}
                  currency={currency}
                  onOpen={open}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Spending;
