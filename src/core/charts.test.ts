import { describe, it, expect } from 'vitest';
import { renderTrend, renderCalendarHeatmap, type DayValue } from './charts';

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const seven = (...vals: number[]): DayValue[] =>
  vals.map((seconds, i) => ({ date: `202606${String(11 + i).padStart(2, '0')}`, seconds }));

describe('renderTrend', () => {
  it('returns empty string for no data or all-zero data', () => {
    expect(renderTrend([])).toBe('');
    expect(renderTrend(seven(0, 0, 0, 0, 0, 0, 0))).toBe('');
  });

  it('renders a gradient area, a line, and one dot per day', () => {
    const svg = renderTrend(seven(0, 0, 0, 0, 0, 0, 7200));
    expect(svg).toContain('class="tt-chart tt-trend"');
    expect(svg).toContain('<linearGradient id="tt-area-grad"');
    expect(svg).toContain('<path class="tt-trend-area"');
    expect(svg).toContain('<path class="tt-trend-line"');
    expect(svg).toContain(' C '); // bezier segments (smooth curve)
    expect(count(svg, 'class="tt-trend-dot"')).toBe(7);
  });

  it('keeps the curve within the plot (margin) and puts the busiest day highest', () => {
    const svg = renderTrend(seven(0, 0, 0, 0, 0, 3600, 7200));
    const cys = [...svg.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cys).toHaveLength(7);
    expect(Math.min(...cys)).toBeGreaterThan(12); // top margin: never touches the top edge
    expect(Math.max(...cys)).toBeLessThan(104); // bottom margin: never touches the baseline
    expect(cys[6]).toBeLessThan(cys[0]); // the busiest day (last) sits above the quietest (first)
  });
});

describe('renderCalendarHeatmap', () => {
  it('returns empty string for no data or all-zero data', () => {
    expect(renderCalendarHeatmap([])).toBe('');
    expect(renderCalendarHeatmap([{ date: '20260616', seconds: 0 }])).toBe('');
  });

  it('renders one cell per day, neutral level 0 for zero days and a colored level otherwise', () => {
    const days: DayValue[] = [
      { date: '20260615', seconds: 0 },
      { date: '20260616', seconds: 3600 },
      { date: '20260617', seconds: 7200 },
    ];
    const svg = renderCalendarHeatmap(days);
    expect(count(svg, 'class="tt-cell')).toBe(3);
    expect(svg).toContain('tt-l0');
    expect(svg).toMatch(/tt-l[1-4]/);
  });

  it('adds the commit count to a cell tooltip, pluralized, and omits it when zero', () => {
    const days: DayValue[] = [
      { date: '20260615', seconds: 3600, commits: 0 },
      { date: '20260616', seconds: 3600, commits: 1 },
      { date: '20260617', seconds: 7200, commits: 3 },
    ];
    const svg = renderCalendarHeatmap(days);
    expect(svg).toContain('2026-06-15: 1.0 h</title>'); // no commits: nothing appended
    expect(svg).toContain('2026-06-16: 1.0 h, 1 commit</title>');
    expect(svg).toContain('2026-06-17: 2.0 h, 3 commits</title>');
  });
});
