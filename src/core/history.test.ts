import { describe, it, expect } from 'vitest';
import { buildHistoryModel, type TaggedInterval } from './history';

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
});
