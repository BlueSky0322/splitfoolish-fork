import { REST } from '../../../split/spending';

// The Spending ring's shape, shared by the chart in Settle up and the share image, which
// draw it at their own sizes from the same 160-unit box

export const RING_SIZE = 160;
export const RING_OUTER = 78;
export const RING_INNER = 52;

/** The annular sector from `from` to `to` (radians, clockwise from the top) */
export function sector(from: number, to: number) {
  const c = RING_SIZE / 2;
  const at = (r: number, a: number) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return (
    `M${at(RING_OUTER, from)}A${RING_OUTER} ${RING_OUTER} 0 ${large} 1 ${at(RING_OUTER, to)}` +
    `L${at(RING_INNER, to)}A${RING_INNER} ${RING_INNER} 0 ${large} 0 ${at(RING_INNER, from)}Z`
  );
}

/** Each slice with its angles, from the top and clockwise, in proportion to its cents */
export function arcsOf<T extends { cents: number }>(slices: T[]) {
  const total = slices.reduce((sum, s) => sum + s.cents, 0);
  let angle = -Math.PI / 2;
  return slices.map((s) => {
    const from = angle;
    angle += (s.cents / total) * 2 * Math.PI;
    return { ...s, from, to: angle };
  });
}

/** A category slice's colour: the series hues in ring order, the folded tail gray */
export const categoryColor = (key: string, index: number) =>
  key === REST ? 'var(--sf-series-rest)' : `var(--sf-series-${index})`;
