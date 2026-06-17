// Pure core: assemble the history view model (per-day totals + commits, SVG charts, monthly
// badges, and a per-window breakdown) from window-tagged intervals. NO 'vscode' import. Charts
// render fixed windows (last 14 days, last 15 weeks) with missing days zero-filled, so a sparse
// history never produces a degenerate, blown-up SVG. The adapter adds localized labels on top.

import { aggregateByDay, buildMonthlyBadges, dayKeyLocal, type MonthlyBadges } from './aggregate';
import { renderTrend, renderCalendarHeatmap, type DayValue } from './charts';
import { mergeIntervals, splitAtMidnight, localMidnightOf, type Interval } from './intervals';

const TREND_HOURS = 24; // the trend spans the last 24 hours
const HEATMAP_WEEKS = 15;
const HOUR_MS = 3_600_000;
const TREND_KERNEL_MS = 45 * 60_000; // half-width of the moving-average window for the activity rate
const TREND_STEP_MS = 10 * 60_000; // sample spacing along the 24h axis

/**
 * Earliest instant the rendered model actually reads: the oldest of the heatmap window
 * (15 weeks, Monday-aligned) and the start of the month-before-previous (the oldest badge).
 * The 24h trend and the 14-day list both fall inside the heatmap window, so they don't widen it.
 * The adapter uses this to skip files older than the window instead of reading the whole history.
 */
export function historyWindowStartMs(nowMs: number): number {
  const now = new Date(nowMs);

  const heatmapStart = new Date(now);
  heatmapStart.setHours(0, 0, 0, 0);
  heatmapStart.setDate(heatmapStart.getDate() - (HEATMAP_WEEKS * 7 - 1));
  heatmapStart.setDate(heatmapStart.getDate() - ((heatmapStart.getDay() + 6) % 7)); // back to Monday

  const oldestBadgeMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);

  return Math.min(heatmapStart.getTime(), oldestBadgeMonth.getTime());
}

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

/** One sample of the 24h activity curve: its instant and the activity rate (0 = idle, 1 = full). */
interface RateSample {
  readonly t: number;
  readonly rate: number;
}

// Activity-rate curve over the last `hours` hours, sampled every TREND_STEP_MS. The rate at each
// sample is the fraction of time actually tracked within a sliding +/-TREND_KERNEL_MS window
// (cross-window union, so two overlapping windows never count twice). This moving average turns
// the binary "tracked or not" signal into a smooth density: a long focus block is a plateau near 1,
// pomodoro shows successive bumps, and absences fall back toward 0. The window is clipped to `now`
// so the most recent sample is not dragged down by the empty future.
function activityRateSeries(tagged: readonly TaggedInterval[], nowMs: number, hours: number): RateSample[] {
  const merged = mergeIntervals(tagged.map((t) => ({ start: t.start, end: t.end })));
  const start = nowMs - hours * HOUR_MS;
  const out: RateSample[] = [];
  for (let t = start; t <= nowMs; t += TREND_STEP_MS) {
    const lo = t - TREND_KERNEL_MS;
    const hi = Math.min(t + TREND_KERNEL_MS, nowMs);
    const width = hi - lo;
    let covered = 0;
    for (const iv of merged) {
      const a = Math.max(lo, iv.start);
      const b = Math.min(hi, iv.end);
      if (b > a) covered += b - a;
    }
    out.push({ t, rate: width > 0 ? covered / width : 0 });
  }
  return out;
}

const hourOf = (ms: number): number => new Date(ms).getHours();
const minuteOf = (ms: number): number => new Date(ms).getMinutes();
const pad2 = (n: number): string => String(n).padStart(2, '0');

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

  // 24h activity-density curve. Many close samples make it genuinely smooth; the value plotted is
  // the 0..1 activity rate (DayValue.seconds carries it). Anchor the Y axis at 0 so absences reach
  // the floor, with the top set to the window's peak plus headroom. Label the axis every 6th hour.
  const samples = activityRateSeries(tagged, nowMs, TREND_HOURS);
  const peak = Math.max(0, ...samples.map((s) => s.rate));
  const trendSeries: DayValue[] = samples.map((s) => ({ date: dayKeyLocal(s.t), seconds: s.rate }));
  const trendSvg = renderTrend(trendSeries, {
    showDots: false,
    scale: { min: 0, max: peak > 0 ? peak * 1.12 : 1 },
    labelOf: (_d, i) => (hourOf(samples[i].t) % 6 === 0 && minuteOf(samples[i].t) < 10 ? pad2(hourOf(samples[i].t)) : ''),
  });

  return {
    days,
    trendSvg,
    heatmapSvg: renderCalendarHeatmap(heatmapSeries(byDay, commitsByDay, nowMs, HEATMAP_WEEKS)),
    months: buildMonthlyBadges(perDay, now.getFullYear(), now.getMonth()),
  };
}
