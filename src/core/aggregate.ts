// Pure core: day/month aggregations and variations. NO 'vscode' import.

import { splitAtMidnight, totalCoveredMs, localMidnightOf, type Interval } from './intervals';

export interface DayTotal {
  /** Local day key, YYYYMMDD format. */
  readonly date: string;
  /** Time covered that day, in ms (no double counting across multiple windows). */
  readonly ms: number;
}

export interface MonthlyBadges {
  /** Current month total (ms). */
  readonly currentMs: number;
  /** Previous month total (ms). */
  readonly previousMs: number;
  /** Month-before-previous total (ms). */
  readonly beforePreviousMs: number;
  /** Variation of the previous month relative to the month before it, in %. null if the base is zero. */
  readonly previousVariationPct: number | null;
}

interface AggregateOptions {
  readonly midnightOf?: (t: number) => number;
  readonly dayKeyOf?: (t: number) => string;
}

/** Local day key YYYYMMDD for a given instant. */
export function dayKeyLocal(t: number): string {
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Aggregates a list of intervals (across all windows) into per-local-day totals.
 * Each interval is split at midnight, grouped by day, then merged (union) so that
 * time covered by multiple windows is not counted twice. Result sorted by date.
 */
export function aggregateByDay(intervals: readonly Interval[], opts: AggregateOptions = {}): DayTotal[] {
  const midnightOf = opts.midnightOf ?? localMidnightOf;
  const dayKeyOf = opts.dayKeyOf ?? dayKeyLocal;

  const groups = new Map<string, Interval[]>();
  for (const iv of intervals) {
    for (const piece of splitAtMidnight(iv, midnightOf)) {
      const key = dayKeyOf(piece.start);
      const arr = groups.get(key);
      if (arr) {
        arr.push(piece);
        continue;
      }
      groups.set(key, [piece]);
    }
  }

  return [...groups.entries()]
    .map(([date, pieces]) => ({ date, ms: totalCoveredMs(pieces) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Relative variation in %, signed. null if the base is zero and the current value is nonzero (no division by 0). */
export function percentVariation(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** YYYYMM key of a month. The Date constructor absorbs an out-of-range month (year rollover). */
export function monthKey(year: number, month0: number): string {
  const d = new Date(year, month0, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function totalForMonth(perDay: readonly DayTotal[], year: number, month0: number): number {
  const key = monthKey(year, month0);
  return perDay.reduce((sum, d) => (d.date.slice(0, 6) === key ? sum + d.ms : sum), 0);
}

/**
 * Builds the monthly totals for the badges: current month, previous month, month before that,
 * and the variation of the previous month relative to the month before it. Handles year boundaries.
 */
export function buildMonthlyBadges(
  perDay: readonly DayTotal[],
  refYear: number,
  refMonth0: number,
): MonthlyBadges {
  const currentMs = totalForMonth(perDay, refYear, refMonth0);
  const previousMs = totalForMonth(perDay, refYear, refMonth0 - 1);
  const beforePreviousMs = totalForMonth(perDay, refYear, refMonth0 - 2);
  return {
    currentMs,
    previousMs,
    beforePreviousMs,
    previousVariationPct: percentVariation(previousMs, beforePreviousMs),
  };
}
