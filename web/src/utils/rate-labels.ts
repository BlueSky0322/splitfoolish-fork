// How exchange rates read on screen

export const SOURCE_LABELS = { wise: 'Wise', frankfurter: 'ECB', manual: 'your rate' } as const;

/** How a rate reads: "1 JPY = 0.0297 MYR", with as many digits as small rates need */
export const describeRate = (rate: number, from: string, to: string) =>
  `1 ${from} = ${rate.toLocaleString(undefined, { maximumSignificantDigits: 4 })} ${to}`;

/** "today 14:20", "yesterday 09:05" or "12 Oct 14:20" */
export function describeWhen(at: number, now = Date.now()) {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  if (at >= dayStart) return `today ${time}`;
  if (at >= dayStart - 24 * 60 * 60 * 1000) return `yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}
