import { describe, it, expect } from 'vitest';
import { renderTrend, renderCalendarHeatmap, type DayValue, type HeatmapLabels } from './charts';

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
// Placeholder words, so a test sees where each label lands and that no English is left in the core.
const LABELS: HeatmapLabels = {
  months: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'],
  weekdays: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
  dayTitle: (date, hours, commits) => `${date}|${hours}|${commits}`,
};
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

  it('honors custom labels (omitting empty ones) and custom tooltips', () => {
    const svg = renderTrend(seven(0, 0, 0, 0, 0, 0, 7200), {
      labelOf: (_d, i) => (i % 2 === 0 ? `L${i}` : ''),
      titleOf: (_d, i) => `point ${i}`,
    });
    expect(svg).toContain('>L0</text>');
    expect(svg).toContain('>L6</text>');
    expect(svg).not.toContain('>L1</text>'); // odd indices omitted
    expect(svg).toContain('<title>point 6</title>');
    expect(svg).not.toContain(' h</title>'); // default tooltip fully overridden
  });

  it('draws a dot without a tooltip when none is given', () => {
    const svg = renderTrend(seven(0, 0, 0, 0, 0, 0, 7200));
    expect(count(svg, 'class="tt-trend-dot"')).toBe(7);
    expect(svg).not.toContain('<title>');
  });

  it('with dots off draws no dots, and a fixed scale anchors a zero value to the baseline', () => {
    const svg = renderTrend(seven(0, 0, 0, 0, 0, 0, 7200), { showDots: false, scale: { min: 0, max: 7200 } });
    expect(svg).not.toContain('tt-trend-dot');
    expect(svg).toContain('<path class="tt-trend-line"');
    // first point is zero -> sits on the baseline (104); the curve starts there
    expect(svg).toContain('<path class="tt-trend-line" d="M 10.0 104.0');
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
    expect(renderCalendarHeatmap([], LABELS)).toBe('');
    expect(renderCalendarHeatmap([{ date: '20260616', seconds: 0 }], LABELS)).toBe('');
  });

  it('renders one cell per day, neutral level 0 for zero days and a colored level otherwise', () => {
    const days: DayValue[] = [
      { date: '20260615', seconds: 0 },
      { date: '20260616', seconds: 3600 },
      { date: '20260617', seconds: 7200 },
    ];
    const svg = renderCalendarHeatmap(days, LABELS);
    expect(count(svg, 'class="tt-cell')).toBe(3);
    expect(svg).toContain('tt-l0');
    expect(svg).toMatch(/tt-l[1-4]/);
  });

  it('titles each cell with its date, hours and commit count, worded by the labels', () => {
    const days: DayValue[] = [
      { date: '20260615', seconds: 5400 },
      { date: '20260616', seconds: 3600, commits: 1 },
      { date: '20260617', seconds: 7200, commits: 3 },
    ];
    const svg = renderCalendarHeatmap(days, LABELS);
    expect(svg).toContain('<title>2026-06-15|1.5|0</title>'); // no commit data counts as zero
    expect(svg).toContain('<title>2026-06-16|1|1</title>');
    expect(svg).toContain('<title>2026-06-17|2|3</title>');
  });

  it('names the months and the Monday, Wednesday and Friday rows with the labels', () => {
    // Monday June 29 to Sunday July 12: the month label sits on each first week of a month.
    const days: DayValue[] = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(2026, 5, 29 + i);
      const compact = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      return { date: compact, seconds: 3600 };
    });
    const texts = [...renderCalendarHeatmap(days, LABELS).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts).toEqual(['M6', 'M7', 'D1', 'D3', 'D5']);
  });

  it('escapes a label before it reaches the markup', () => {
    const svg = renderCalendarHeatmap([{ date: '20260615', seconds: 3600 }], {
      ...LABELS,
      months: LABELS.months.map(() => 'a<b'),
      dayTitle: () => 'x & y',
    });
    expect(svg).toContain('>a&lt;b</text>');
    expect(svg).toContain('<title>x &amp; y</title>');
  });
});
