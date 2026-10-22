import { describe, it, expect } from 'vitest';
import {
  dayKeyLocal,
  aggregateByDay,
  percentVariation,
  buildMonthlyBadges,
  buildMonthsOverview,
  type DayTotal,
} from './aggregate';
import type { Interval } from './intervals';

const at = (y: number, mo1: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, mo1 - 1, d, hh, mm, 0, 0).getTime();
const h = (n: number): number => n * 3_600_000;

describe('dayKeyLocal', () => {
  it('formats the day key as YYYYMMDD (local time)', () => {
    expect(dayKeyLocal(at(2026, 6, 16, 14, 37))).toBe('20260616');
  });
});

describe('aggregateByDay', () => {
  it('returns an empty array when there is no data', () => {
    expect(aggregateByDay([])).toEqual([]);
  });

  it('sums an interval contained within a single day', () => {
    const iv: Interval = { start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 12) };
    expect(aggregateByDay([iv])).toEqual([{ date: '20260616', ms: h(3) }]);
  });

  it('splits an interval that crosses midnight across both days', () => {
    const iv: Interval = { start: at(2026, 6, 16, 22), end: at(2026, 6, 17, 2) };
    expect(aggregateByDay([iv])).toEqual([
      { date: '20260616', ms: h(2) },
      { date: '20260617', ms: h(2) },
    ]);
  });

  it('merges the time of two overlapping windows on the same day (3h)', () => {
    const window1: Interval = { start: at(2026, 6, 16, 14), end: at(2026, 6, 16, 16) };
    const window2: Interval = { start: at(2026, 6, 16, 14, 30), end: at(2026, 6, 16, 17) };
    expect(aggregateByDay([window1, window2])).toEqual([{ date: '20260616', ms: h(3) }]);
  });

  it('sorts the days in chronological order', () => {
    const j17: Interval = { start: at(2026, 6, 17, 9), end: at(2026, 6, 17, 10) };
    const j15: Interval = { start: at(2026, 6, 15, 9), end: at(2026, 6, 15, 10) };
    expect(aggregateByDay([j17, j15]).map((d) => d.date)).toEqual(['20260615', '20260617']);
  });
});

describe('percentVariation', () => {
  it('increase of 10 %', () => {
    expect(percentVariation(110, 100)).toBe(10);
  });

  it('decrease of 8 %', () => {
    expect(percentVariation(92, 100)).toBeCloseTo(-8, 10);
  });

  it('returns 0 when both values are zero', () => {
    expect(percentVariation(0, 0)).toBe(0);
  });

  it('returns null when the base is zero but the current value is not (no division by 0)', () => {
    expect(percentVariation(50, 0)).toBeNull();
  });
});

describe('buildMonthlyBadges', () => {
  const perDay: DayTotal[] = [
    { date: '20260410', ms: h(10) }, // April (the month before last): 10h
    { date: '20260512', ms: h(5) }, // May (last month): 8h in total
    { date: '20260514', ms: h(3) },
    { date: '20260601', ms: h(6) }, // June (current month): 6h
  ];

  it('totals the current month and the previous month', () => {
    const badges = buildMonthlyBadges(perDay, 2026, 5); // refMonth0 = 5 => June
    expect(badges.currentMs).toBe(h(6));
    expect(badges.previousMs).toBe(h(8));
  });

  it('computes last month variation relative to the month before last', () => {
    const badges = buildMonthlyBadges(perDay, 2026, 5); // May (8h) vs April (10h) = -20 %
    expect(badges.beforePreviousMs).toBe(h(10));
    expect(badges.previousVariationPct).toBeCloseTo(-20, 10);
  });

  it('handles the year rollover (January -> previous December)', () => {
    const data: DayTotal[] = [
      { date: '20251215', ms: h(4) }, // December 2025
      { date: '20260105', ms: h(2) }, // January 2026
    ];
    const badges = buildMonthlyBadges(data, 2026, 0); // January 2026
    expect(badges.currentMs).toBe(h(2));
    expect(badges.previousMs).toBe(h(4));
  });
});

describe('buildMonthsOverview', () => {
  it('totals the whole history', () => {
    const data: DayTotal[] = [
      { date: '20250110', ms: h(2) },
      { date: '20260616', ms: h(3) },
    ];
    expect(buildMonthsOverview(data, 2026, 5).totalMs).toBe(h(5));
  });

  it('lists each month with tracked time, newest first, skipping empty months', () => {
    const data: DayTotal[] = [
      { date: '20260110', ms: h(2) }, // January: 3h in total
      { date: '20260112', ms: h(1) },
      { date: '20260520', ms: h(4) }, // May (last month)
      { date: '20260616', ms: h(6) }, // June (current month)
    ];
    expect(buildMonthsOverview(data, 2026, 5).months).toEqual([
      { month: '202606', ms: h(6) },
      { month: '202605', ms: h(4) },
      { month: '202601', ms: h(3) },
    ]);
  });

  it('lists last month even when it has no tracked time', () => {
    const data: DayTotal[] = [{ date: '20260616', ms: h(2) }];
    expect(buildMonthsOverview(data, 2026, 5).months).toEqual([
      { month: '202606', ms: h(2) },
      { month: '202605', ms: 0 },
    ]);
  });

  it('leaves out the current month while it has no tracked time', () => {
    const data: DayTotal[] = [{ date: '20260520', ms: h(4) }];
    expect(buildMonthsOverview(data, 2026, 5).months).toEqual([{ month: '202605', ms: h(4) }]);
  });

  it('finds last month across the year rollover (January -> previous December)', () => {
    expect(buildMonthsOverview([], 2026, 0)).toEqual({ totalMs: 0, months: [{ month: '202512', ms: 0 }] });
  });
});
