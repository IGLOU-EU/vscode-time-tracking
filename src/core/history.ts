// Pure core: assemble the history view model (per-day totals + commits, SVG charts, monthly
// badges, and a per-window breakdown) from window-tagged intervals. NO 'vscode' import. Charts
// render fixed windows (last 14 days, last 15 weeks) with missing days zero-filled, so a sparse
// history never produces a degenerate, blown-up SVG. The adapter adds localized labels on top.

import { aggregateByDay, buildMonthlyBadges, dayKeyLocal, type MonthlyBadges } from './aggregate';
import { renderTrend, renderCalendarHeatmap, type DayValue } from './charts';
import { mergeIntervals, splitAtMidnight, localMidnightOf, type Interval } from './intervals';

const TREND_DAYS = 7;
const HEATMAP_WEEKS = 15;

/** An interval tagged with the window that produced it. */
export interface TaggedInterval {
  readonly windowId: string;
  readonly start: number;
  readonly end: number;
}

/** One window's contribution to a day: its merged active ranges and total. */
export interface WindowBreakdown {
  readonly windowId: string;
  readonly ranges: Interval[];
  readonly ms: number;
}

export interface HistoryDay {
  readonly date: string; // YYYYMMDD
  readonly seconds: number;
  readonly commits: number;
  /** Per-window detail. Length > 1 means several windows worked the project that day. */
  readonly windows: WindowBreakdown[];
}

export interface HistoryModel {
  readonly days: HistoryDay[];
  readonly trendSvg: string;
  readonly heatmapSvg: string;
  readonly months: MonthlyBadges;
}

// Group tagged intervals into per-day, per-window merged ranges (split at midnight first).
function breakdownByDay(tagged: readonly TaggedInterval[]): Map<string, WindowBreakdown[]> {
  const byDay = new Map<string, Map<string, Interval[]>>();
  for (const t of tagged) {
    for (const seg of splitAtMidnight({ start: t.start, end: t.end }, localMidnightOf)) {
      const day = dayKeyLocal(seg.start);
      let windows = byDay.get(day);
      if (!windows) {
        windows = new Map();
        byDay.set(day, windows);
      }
      const segs = windows.get(t.windowId);
      if (segs) segs.push(seg);
      else windows.set(t.windowId, [seg]);
    }
  }

  const out = new Map<string, WindowBreakdown[]>();
  for (const [day, windows] of byDay) {
    const list: WindowBreakdown[] = [];
    for (const [windowId, segs] of windows) {
      const ranges = mergeIntervals(segs);
      const ms = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      list.push({ windowId, ranges, ms });
    }
    list.sort((a, b) => (a.ranges[0]?.start ?? 0) - (b.ranges[0]?.start ?? 0));
    out.set(day, list);
  }
  return out;
}

// Continuous, zero-filled day window ending at the local day of endMs (oldest to newest).
function lastNDaysSeries(byDay: Map<string, number>, endMs: number, n: number): DayValue[] {
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  const out: DayValue[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = dayKeyLocal(d.getTime());
    out.push({ date: key, seconds: byDay.get(key) ?? 0 });
  }
  return out;
}

// Continuous, Monday-aligned, zero-filled window of about `weeks` weeks ending at endMs.
// Carries the commit count per day so the heatmap tooltip can show it.
function heatmapSeries(
  byDay: Map<string, number>,
  commitsByDay: Readonly<Record<string, number>>,
  endMs: number,
  weeks: number,
): DayValue[] {
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const out: DayValue[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const key = dayKeyLocal(cursor.getTime());
    out.push({ date: key, seconds: byDay.get(key) ?? 0, commits: commitsByDay[key] ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Build the full history model from window-tagged intervals. Day totals and charts use the
 * cross-window union (no double counting); the per-day window breakdown keeps each window's own
 * ranges. `commitsByDay` maps YYYYMMDD to a commit count. `nowMs` anchors the chart windows and
 * the current month for the badges.
 */
export function buildHistoryModel(
  tagged: readonly TaggedInterval[],
  commitsByDay: Readonly<Record<string, number>>,
  nowMs: number,
): HistoryModel {
  const now = new Date(nowMs);
  const perDay = aggregateByDay(tagged.map((t) => ({ start: t.start, end: t.end })));
  const breakdown = breakdownByDay(tagged);

  const days: HistoryDay[] = perDay.map((d) => ({
    date: d.date,
    seconds: Math.round(d.ms / 1000),
    commits: commitsByDay[d.date] ?? 0,
    windows: breakdown.get(d.date) ?? [],
  }));

  const byDay = new Map<string, number>(days.map((d) => [d.date, d.seconds]));

  return {
    days,
    trendSvg: renderTrend(lastNDaysSeries(byDay, nowMs, TREND_DAYS)),
    heatmapSvg: renderCalendarHeatmap(heatmapSeries(byDay, commitsByDay, nowMs, HEATMAP_WEEKS)),
    months: buildMonthlyBadges(perDay, now.getFullYear(), now.getMonth()),
  };
}
