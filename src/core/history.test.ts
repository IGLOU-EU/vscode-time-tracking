import { describe, it, expect } from 'vitest';
import { buildHistoryModel, historyWindowStartMs, type TaggedInterval } from './history';

const at = (y: number, mo1: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, mo1 - 1, d, hh, mm, 0, 0).getTime();
const h = (n: number): number => n * 3_600_000;
const NOW = at(2026, 6, 16, 12); // anchor: June 16, 2026, noon
const tagged = (windowId: string, start: number, end: number): TaggedInterval => ({ windowId, start, end });

describe('buildHistoryModel', () => {
  it('combines per-day seconds with the commit counts for the same day', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 12))];
    const model = buildHistoryModel(intervals, { '20260616': 4 }, NOW);
    expect(model.days[0]).toMatchObject({ date: '20260616', seconds: h(3) / 1000, commits: 4 });
  });

  it('defaults commits to zero for days without git data', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 10))];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].commits).toBe(0);
  });

  it('produces non-empty SVG charts when there is data in the window', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 10))];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.trendSvg).toContain('<svg');
    expect(model.heatmapSvg).toContain('<svg');
  });

  it('draws the 24h activity curve when there is activity within the last day', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 10))]; // 3h before NOW
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.trendSvg).toContain('<path class="tt-trend-line"');
    expect(model.trendSvg).toContain('<path class="tt-trend-area"');
    expect(model.trendSvg).not.toContain('tt-trend-dot'); // density curve has no per-point dots
  });

  it('leaves the 24h trend empty when all activity is older than 24h, keeping the heatmap', () => {
    const intervals = [tagged('w1', at(2026, 6, 14, 9), at(2026, 6, 14, 12))]; // two days before NOW
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.trendSvg).toBe(''); // nothing in the last 24h -> no curve
    expect(model.heatmapSvg).not.toBe(''); // but the day still shows in the heatmap and day list
  });

  it('exposes monthly totals for the badges', () => {
    const intervals = [
      tagged('w1', at(2026, 5, 10, 9), at(2026, 5, 10, 11)), // May: 2h
      tagged('w1', at(2026, 6, 1, 9), at(2026, 6, 1, 12)), // June: 3h
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.months.currentMs).toBe(h(3));
    expect(model.months.previousMs).toBe(h(2));
  });

  it('returns empty data and empty charts for no intervals', () => {
    const model = buildHistoryModel([], {}, NOW);
    expect(model.days).toEqual([]);
    expect(model.months.currentMs).toBe(0);
    expect(model.trendSvg).toBe(''); // all-zero window -> no SVG, webview shows the empty state
    expect(model.heatmapSvg).toBe('');
  });

  it('reports a single window for a day touched by one window', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 12))];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].windows).toHaveLength(1);
    expect(model.days[0].windows[0]).toMatchObject({ windowId: 'w1', ms: h(3) });
  });

  it('breaks a day down per window while the day total stays merged (3h)', () => {
    const intervals = [
      tagged('w1', at(2026, 6, 16, 14), at(2026, 6, 16, 16)), // 14:00-16:00 (2h)
      tagged('w2', at(2026, 6, 16, 14, 30), at(2026, 6, 16, 17)), // 14:30-17:00 (2.5h)
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    const day = model.days[0];
    expect(day.seconds).toBe(h(3) / 1000); // merged union, no double counting
    expect(day.windows).toHaveLength(2);
    expect(day.windows.find((w) => w.windowId === 'w1')?.ms).toBe(h(2));
    expect(day.windows.find((w) => w.windowId === 'w2')?.ms).toBe(h(2.5));
  });

  it('merges a single window own overlapping intervals in its breakdown', () => {
    const intervals = [
      tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 11)),
      tagged('w1', at(2026, 6, 16, 10), at(2026, 6, 16, 12)),
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].windows).toHaveLength(1);
    expect(model.days[0].windows[0].ranges).toEqual([{ start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 12) }]);
  });

  it('reports a single session for one continuous block', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 12))];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].sessions).toEqual([{ start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 12) }]);
  });

  it('lists one session per contiguous work block, with the gap between them kept', () => {
    const intervals = [
      tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 11)), // morning
      tagged('w1', at(2026, 6, 16, 14), at(2026, 6, 16, 15)), // afternoon: a real gap -> a second session
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].sessions).toEqual([
      { start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 11) },
      { start: at(2026, 6, 16, 14), end: at(2026, 6, 16, 15) },
    ]);
  });

  it('merges overlapping sessions across windows into the day work blocks (no double session)', () => {
    const intervals = [
      tagged('w1', at(2026, 6, 16, 14), at(2026, 6, 16, 16)),
      tagged('w2', at(2026, 6, 16, 15), at(2026, 6, 16, 17)),
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].sessions).toEqual([{ start: at(2026, 6, 16, 14), end: at(2026, 6, 16, 17) }]);
  });

  it('labels a manual entry session block with its reason', () => {
    const intervals: TaggedInterval[] = [
      { windowId: 'w1', start: at(2026, 6, 16, 14), end: at(2026, 6, 16, 15), reason: 'Meeting' },
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].sessions).toEqual([
      { start: at(2026, 6, 16, 14), end: at(2026, 6, 16, 15), reason: 'Meeting' },
    ]);
  });

  it('keeps auto-tracked session blocks free of a reason field', () => {
    const intervals = [tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 10))];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].sessions[0]).not.toHaveProperty('reason');
  });

  it('carries the reason onto the merged block when a manual entry overlaps auto time (no double count)', () => {
    const intervals: TaggedInterval[] = [
      tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 11)), // auto 2h
      { windowId: 'w1', start: at(2026, 6, 16, 10), end: at(2026, 6, 16, 12), reason: 'Meeting' }, // manual, overlaps
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].seconds).toBe(h(3) / 1000); // 09:00-12:00 union, counted once
    expect(model.days[0].sessions).toEqual([
      { start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 12), reason: 'Meeting' },
    ]);
  });

  it('joins several distinct reasons that fall in the same block', () => {
    const intervals: TaggedInterval[] = [
      { windowId: 'w1', start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 10), reason: 'Meeting' },
      { windowId: 'w1', start: at(2026, 6, 16, 10), end: at(2026, 6, 16, 11), reason: 'Review' },
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].sessions).toEqual([
      { start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 11), reason: 'Meeting, Review' },
    ]);
  });

  it('exposes the day manual spans so the export can attribute time by source', () => {
    const intervals: TaggedInterval[] = [
      tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 11)), // auto
      { windowId: 'w1', start: at(2026, 6, 16, 10), end: at(2026, 6, 16, 12), reason: 'Meeting' },
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].manual).toEqual([
      { start: at(2026, 6, 16, 10), end: at(2026, 6, 16, 12), reason: 'Meeting' },
    ]);
  });

  it('keeps the manual spans empty for purely auto-tracked days', () => {
    const model = buildHistoryModel([tagged('w1', at(2026, 6, 16, 9), at(2026, 6, 16, 10))], {}, NOW);
    expect(model.days[0].manual).toEqual([]);
  });

  it('orders the manual spans by start time regardless of input order', () => {
    const intervals: TaggedInterval[] = [
      { windowId: 'w1', start: at(2026, 6, 16, 14), end: at(2026, 6, 16, 15), reason: 'Review' },
      { windowId: 'w1', start: at(2026, 6, 16, 9), end: at(2026, 6, 16, 10), reason: 'Meeting' },
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].manual.map((m) => m.reason)).toEqual(['Meeting', 'Review']);
  });

  it('splits a cross-midnight manual span onto both days', () => {
    const intervals: TaggedInterval[] = [
      { windowId: 'w1', start: at(2026, 6, 15, 23), end: at(2026, 6, 16, 1), reason: 'Deploy' },
    ];
    const model = buildHistoryModel(intervals, {}, NOW);
    expect(model.days[0].manual).toEqual([
      { start: at(2026, 6, 15, 23), end: at(2026, 6, 16), reason: 'Deploy' },
    ]);
    expect(model.days[1].manual).toEqual([
      { start: at(2026, 6, 16), end: at(2026, 6, 16, 1), reason: 'Deploy' },
    ]);
  });
});

describe('historyWindowStartMs', () => {
  it('starts no later than the oldest day the heatmap draws', () => {
    // Heatmap spans 15 weeks ending today, aligned back to Monday.
    const heatmapStart = new Date(NOW);
    heatmapStart.setHours(0, 0, 0, 0);
    heatmapStart.setDate(heatmapStart.getDate() - (15 * 7 - 1));
    heatmapStart.setDate(heatmapStart.getDate() - ((heatmapStart.getDay() + 6) % 7));
    expect(historyWindowStartMs(NOW)).toBeLessThanOrEqual(heatmapStart.getTime());
  });

  it('covers the oldest month the badges need (month before previous)', () => {
    // NOW is June 2026, so the oldest badge month is April; its first day must be inside the window.
    const oldestBadge = at(2026, 4, 1);
    expect(historyWindowStartMs(NOW)).toBeLessThanOrEqual(oldestBadge);
  });

  it('does not reach absurdly far back (within ~16 weeks)', () => {
    const sixteenWeeks = NOW - 16 * 7 * 24 * 3_600_000;
    expect(historyWindowStartMs(NOW)).toBeGreaterThanOrEqual(sixteenWeeks);
  });
});
