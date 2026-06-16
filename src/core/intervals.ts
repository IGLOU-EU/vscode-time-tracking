// Pure core: NO 'vscode' import. Deterministic computations over time intervals.
// Instants are epoch ms. The timezone is injected via midnightOf to stay testable.

export interface Interval {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;

/**
 * Union of intervals: merges those that overlap or touch (end == start).
 * Does not mutate the input. Returns a sorted, disjoint list.
 */
export function mergeIntervals(input: readonly Interval[]): Interval[] {
  if (input.length === 0) return [];

  const sorted = [...input].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
      continue;
    }
    out.push({ ...cur });
  }
  return out;
}

/**
 * Time actually covered by a set of intervals, without double counting.
 * This is the basis for multi-window merging: two overlapping windows count only once.
 */
export function totalCoveredMs(input: readonly Interval[]): number {
  return mergeIntervals(input).reduce((sum, iv) => sum + (iv.end - iv.start), 0);
}

/**
 * Splits an interval at each midnight (according to midnightOf, which carries the timezone).
 * midnightOf(t) returns the instant of the last midnight at or before t.
 * An interval of zero duration returns an empty list.
 */
export function splitAtMidnight(iv: Interval, midnightOf: (t: number) => number): Interval[] {
  const parts: Interval[] = [];
  let cursor = iv.start;
  while (cursor < iv.end) {
    const nextMidnight = midnightOf(cursor) + DAY_MS;
    const end = Math.min(nextMidnight, iv.end);
    parts.push({ start: cursor, end });
    cursor = end;
  }
  return parts;
}

/**
 * Local midnight (machine time) of the day containing t. Uses Date, so it is not injected.
 * Pass it as midnightOf to splitAtMidnight for splitting by actual day.
 */
export function localMidnightOf(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}
