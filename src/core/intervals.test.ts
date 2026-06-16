import { describe, it, expect } from 'vitest';
import {
  mergeIntervals,
  totalCoveredMs,
  splitAtMidnight,
  localMidnightOf,
  type Interval,
} from './intervals';

const DAY = 86_400_000;
const utcMidnightOf = (t: number): number => Math.floor(t / DAY) * DAY;
const h = (n: number): number => n * 3_600_000; // n hours in ms

describe('mergeIntervals', () => {
  it('returns an empty array for an empty input', () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it('leaves a single interval unchanged', () => {
    expect(mergeIntervals([{ start: 10, end: 20 }])).toEqual([{ start: 10, end: 20 }]);
  });

  it('merges two overlapping intervals (two windows, same project)', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 50, end: 200 }])).toEqual([
      { start: 0, end: 200 },
    ]);
  });

  it('merges two intervals that touch exactly (end == start)', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 100, end: 200 }])).toEqual([
      { start: 0, end: 200 },
    ]);
  });

  it('keeps separate intervals disjoint', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 300, end: 400 }])).toEqual([
      { start: 0, end: 100 },
      { start: 300, end: 400 },
    ]);
  });

  it('absorbs an interval fully contained within another', () => {
    expect(mergeIntervals([{ start: 0, end: 500 }, { start: 100, end: 200 }])).toEqual([
      { start: 0, end: 500 },
    ]);
  });

  it('sorts an unsorted input before merging', () => {
    expect(
      mergeIntervals([
        { start: 300, end: 400 },
        { start: 0, end: 100 },
        { start: 50, end: 90 },
      ]),
    ).toEqual([
      { start: 0, end: 100 },
      { start: 300, end: 400 },
    ]);
  });

  it('merges a chain of overlaps into a single interval', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 100 },
        { start: 90, end: 200 },
        { start: 150, end: 250 },
      ]),
    ).toEqual([{ start: 0, end: 250 }]);
  });

  it('does not mutate the input array', () => {
    const input: Interval[] = [
      { start: 300, end: 400 },
      { start: 0, end: 100 },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeIntervals(input);
    expect(input).toEqual(snapshot);
  });
});

describe('totalCoveredMs', () => {
  it('is 0 for an empty input', () => {
    expect(totalCoveredMs([])).toBe(0);
  });

  it('sums disjoint intervals', () => {
    expect(totalCoveredMs([{ start: 0, end: 100 }, { start: 300, end: 400 }])).toBe(200);
  });

  it('does not double-count time covered by two windows (14h-16h + 14h30-17h = 3h)', () => {
    const window1: Interval = { start: h(14), end: h(16) };
    const window2: Interval = { start: h(14.5), end: h(17) };
    expect(totalCoveredMs([window1, window2])).toBe(h(3));
  });
});

describe('splitAtMidnight', () => {
  it('leaves an interval within a single day unchanged', () => {
    const iv: Interval = { start: 5 * DAY + h(9), end: 5 * DAY + h(17) };
    expect(splitAtMidnight(iv, utcMidnightOf)).toEqual([iv]);
  });

  it('splits an interval that crosses a midnight', () => {
    const iv: Interval = { start: 5 * DAY + h(22), end: 6 * DAY + h(2) };
    expect(splitAtMidnight(iv, utcMidnightOf)).toEqual([
      { start: 5 * DAY + h(22), end: 6 * DAY },
      { start: 6 * DAY, end: 6 * DAY + h(2) },
    ]);
  });

  it('splits an interval that crosses two midnights into three segments', () => {
    const iv: Interval = { start: 5 * DAY + h(22), end: 7 * DAY + h(1) };
    expect(splitAtMidnight(iv, utcMidnightOf)).toEqual([
      { start: 5 * DAY + h(22), end: 6 * DAY },
      { start: 6 * DAY, end: 7 * DAY },
      { start: 7 * DAY, end: 7 * DAY + h(1) },
    ]);
  });

  it('does not produce an empty segment when the end falls exactly at midnight', () => {
    const iv: Interval = { start: 5 * DAY + h(22), end: 6 * DAY };
    expect(splitAtMidnight(iv, utcMidnightOf)).toEqual([{ start: 5 * DAY + h(22), end: 6 * DAY }]);
  });

  it('returns an empty array for a zero-duration interval', () => {
    expect(splitAtMidnight({ start: 5 * DAY, end: 5 * DAY }, utcMidnightOf)).toEqual([]);
  });
});

describe('localMidnightOf', () => {
  it('returns an instant at local midnight (hours/min/sec/ms at zero)', () => {
    const t = new Date(2026, 5, 16, 14, 37, 12, 500).getTime();
    const midnight = new Date(localMidnightOf(t));
    expect([midnight.getHours(), midnight.getMinutes(), midnight.getSeconds(), midnight.getMilliseconds()]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('brackets the instant: midnight <= t < midnight + 24h', () => {
    const t = new Date(2026, 5, 16, 14, 37, 12, 500).getTime();
    const m = localMidnightOf(t);
    expect(m).toBeLessThanOrEqual(t);
    expect(t).toBeLessThan(m + DAY);
  });

  it('is idempotent: localMidnightOf(localMidnightOf(t)) == localMidnightOf(t)', () => {
    const t = new Date(2026, 5, 16, 14, 37, 12, 500).getTime();
    expect(localMidnightOf(localMidnightOf(t))).toBe(localMidnightOf(t));
  });
});
