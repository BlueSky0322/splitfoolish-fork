import { SegmentedControl } from '@mantine/core';
import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { useSplitState } from '../../../split/SplitStateContext';
import { REST, byCategory, byPayer, byShare, foldTail, percentOf } from '../../../split/spending';
import type { Slice } from '../../../split/spending';
import { formatAmount, formatMoney } from '../../../utils/money';
import { plural } from '../../../utils/text';
import { usePersonColors } from '../person-colors-context';
import { useSplitPage } from '../SplitPageContext';
import classes from './Spending.module.css';

type View = 'categories' | 'paid' | 'shares';

const VIEWS: { value: View; label: string }[] = [
  { value: 'categories', label: 'Categories' },
  { value: 'paid', label: 'Paid by' },
  { value: 'shares', label: 'Shares' },
];

// The ring: a 2px gap of the surface between slices, and the figure in the middle
const SIZE = 160;
const OUTER = 78;
const INNER = 52;

/** The annular sector from `from` to `to` (radians, clockwise from the top) */
function sector(from: number, to: number) {
  const c = SIZE / 2;
  const at = (r: number, a: number) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return (
    `M${at(OUTER, from)}A${OUTER} ${OUTER} 0 ${large} 1 ${at(OUTER, to)}` +
    `L${at(INNER, to)}A${INNER} ${INNER} 0 ${large} 0 ${at(INNER, from)}Z`
  );
}

/**
 * Where the money went: a ring of the biggest slices with the total in the middle, and
 * every slice as a row with a bar, its amount and its share. By category, by who paid,
 * or by whose share it was. Tap or hover a slice or row and the middle shows it.
 */
const Spending = () => {
  const { totals, currency } = useSplitPage();
  const { people, items } = useSplitState().state;
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
        ? s.key === REST
          ? 'var(--sf-series-rest)'
          : `var(--sf-series-${i})`
        : colorOf({ personId: s.key })?.fill ?? 'var(--sf-series-rest)',
  }));
  const focusKey = picked ?? hovered;
  const focused = colored.find((s) => s.key === focusKey) ?? null;
  const max = Math.max(1, ...slices.map((s) => s.cents));

  const change = (next: View) => {
    setView(next);
    setPicked(null);
    setHovered(null);
  };
  const toggle = (key: string) => setPicked((now) => (now === key ? null : key));
  const onKey = (e: KeyboardEvent, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(key);
    }
  };
  const describe = (s: Slice) =>
    `${s.label}, ${formatMoney(s.cents, currency)}, ${percentOf(s.cents, total)}%`;

  // Each slice's angles, from the top and clockwise
  let angle = -Math.PI / 2;
  const arcs = colored.map((s) => {
    const from = angle;
    angle += (s.cents / total) * 2 * Math.PI;
    return { ...s, from, to: angle };
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
        <svg
          className={classes.ring}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="group"
          aria-label={`Spending by ${VIEWS.find((v) => v.value === view)!.label.toLowerCase()}`}
        >
          {arcs.length === 1 ? (
            <circle
              className={classes.slice}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={(OUTER + INNER) / 2}
              fill="none"
              stroke={arcs[0].color}
              strokeWidth={OUTER - INNER}
              role="button"
              tabIndex={0}
              aria-label={describe(arcs[0])}
              aria-pressed={picked === arcs[0].key}
              onClick={() => toggle(arcs[0].key)}
              onKeyDown={(e) => onKey(e, arcs[0].key)}
              onMouseEnter={() => setHovered(arcs[0].key)}
              onMouseLeave={() => setHovered(null)}
            />
          ) : (
            arcs.map((s) => (
              <path
                key={s.key}
                className={classes.slice}
                d={sector(s.from, s.to)}
                fill={s.color}
                data-dim={focusKey != null && focusKey !== s.key ? '' : undefined}
                role="button"
                tabIndex={0}
                aria-label={describe(s)}
                aria-pressed={picked === s.key}
                onClick={() => toggle(s.key)}
                onKeyDown={(e) => onKey(e, s.key)}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.key)}
                onBlur={() => setHovered(null)}
              />
            ))
          )}
          <text
            className={classes.centreValue}
            x={SIZE / 2}
            y={SIZE / 2 - 2}
            textAnchor="middle"
          >
            {formatAmount(focused?.cents ?? total, currency)}
          </text>
          <text
            className={classes.centreLabel}
            x={SIZE / 2}
            y={SIZE / 2 + 16}
            textAnchor="middle"
          >
            {focused
              ? `${focused.label} · ${percentOf(focused.cents, total)}%`
              : `${currency} · ${plural(items.length, 'item')}`}
          </text>
        </svg>
        <div
          className={classes.rows}
          role="group"
          aria-label="Slices"
        >
          {colored.map((s) => (
            <button
              key={s.key}
              type="button"
              className={classes.row}
              aria-label={describe(s)}
              aria-pressed={picked === s.key}
              data-dim={focusKey != null && focusKey !== s.key ? '' : undefined}
              onClick={() => toggle(s.key)}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
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
          ))}
        </div>
      </div>
    </div>
  );
};

export default Spending;
