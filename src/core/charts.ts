// Pure core: SVG renderers (7-day trend line, GitHub-style calendar heatmap). NO 'vscode' import.
// Both render at a fixed viewBox and are stretched to 100% width by CSS (ratio preserved). The
// trend uses a fixed plot height with the Y axis scaled to the min..max of the window, so a 0h
// and a 21h day never blow the height up. Colors are CSS classes (theme accent), never inline.

export interface DayValue {
  readonly date: string; // YYYYMMDD
  readonly seconds: number;
  /** My commits that day. Shown in the heatmap tooltip when present and nonzero. */
  readonly commits?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function iso(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function dateOf(compact: string): Date {
  return new Date(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8)));
}

const hoursLabel = (seconds: number): string => (seconds / 3600).toFixed(1);
const commitsSuffix = (commits: number | undefined): string =>
  commits && commits > 0 ? `, ${commits} commit${commits > 1 ? 's' : ''}` : '';
const dayNumber = (compact: string): string => String(Number(compact.slice(6, 8)));
const allZero = (series: readonly DayValue[]): boolean => series.every((d) => d.seconds === 0);

interface Point {
  x: number;
  y: number;
}

// Smooth path through the points using a uniform Catmull-Rom spline converted to cubic beziers
// (the "smooth" line style, like Grafana). Endpoints duplicate so the ends are not clipped.
function smoothPath(pts: readonly Point[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Trend geometry (viewBox px). Fixed height (ratio close to the heatmap so the two line up). The
// Y axis spans the window's min..max with a margin, so the curve never touches the top or bottom.
const TREND = { width: 300, height: 130, padX: 10, top: 12, baseline: 104, labelY: 120, yMarginRatio: 0.12 };

/** 7-day trend: a thick line with one dot per day and a soft gradient area underneath. */
export function renderTrend(series: readonly DayValue[]): string {
  if (series.length === 0 || allZero(series)) return ''; // empty state handled by the webview

  const { width, height, padX, top, baseline, labelY, yMarginRatio } = TREND;
  const n = series.length;
  const values = series.map((d) => d.seconds);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const margin = span > 0 ? span * yMarginRatio : 1; // headroom above/below, or a flat-line default
  const lo = min - margin;
  const range = max + margin - lo;
  const plotH = baseline - top;
  const innerW = width - padX * 2;

  const xOf = (i: number): number => (n === 1 ? width / 2 : padX + (i / (n - 1)) * innerW);
  const yOf = (v: number): number => baseline - ((v - lo) / range) * plotH;

  const points: Point[] = series.map((d, i) => ({ x: xOf(i), y: yOf(d.seconds) }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${xOf(n - 1).toFixed(1)} ${baseline} L ${xOf(0).toFixed(1)} ${baseline} Z`;
  const dots = series
    .map(
      (d, i) =>
        `<circle class="tt-trend-dot" cx="${xOf(i).toFixed(1)}" cy="${yOf(d.seconds).toFixed(1)}" r="2.5">` +
        `<title>${esc(iso(d.date))}: ${hoursLabel(d.seconds)} h</title></circle>`,
    )
    .join('');
  const labels = series
    .map((d, i) => `<text class="tt-axis-label" x="${xOf(i).toFixed(1)}" y="${labelY}" text-anchor="middle">${dayNumber(d.date)}</text>`)
    .join('');
  // Vertical gradient for the area fill (Grafana-like fade). Stop colors come from CSS (theme accent).
  const defs =
    `<defs><linearGradient id="tt-area-grad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop class="tt-area-stop-top" offset="0%" /><stop class="tt-area-stop-bottom" offset="100%" />` +
    `</linearGradient></defs>`;

  return (
    `<svg class="tt-chart tt-trend" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img">${defs}` +
    `<path class="tt-trend-area" d="${areaPath}" />` +
    `<path class="tt-trend-line" d="${linePath}" />` +
    dots +
    labels +
    `</svg>`
  );
}

// Heatmap geometry (px). cell 11, gap 3, step 14. 7 rows, Monday on top.
const HM = { cell: 11, gap: 3, labelLeft: 20, topBand: 14 };

function bucketLevels(series: readonly DayValue[]): (seconds: number) => number {
  const nonZero = series
    .map((d) => d.seconds)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const q = (p: number): number =>
    nonZero.length === 0 ? 0 : nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))];
  const t1 = q(0.25);
  const t2 = q(0.5);
  const t3 = q(0.75);
  return (seconds: number): number => {
    if (seconds <= 0) return 0;
    if (seconds <= t1) return 1;
    if (seconds <= t2) return 2;
    if (seconds <= t3) return 3;
    return 4;
  };
}

/** Calendar heatmap. `series` is a continuous, Monday-aligned, zero-filled day window. */
export function renderCalendarHeatmap(series: readonly DayValue[]): string {
  if (series.length === 0 || allZero(series)) return ''; // empty state handled by the webview

  const step = HM.cell + HM.gap;
  const level = bucketLevels(series);

  const cells: string[] = [];
  const months: string[] = [];
  let col = 0;
  let maxCol = 0;
  let lastMonth = -1;

  series.forEach((d, i) => {
    const date = dateOf(d.date);
    const row = (date.getDay() + 6) % 7; // 0 = Monday
    if (row === 0 && i > 0) col += 1;
    maxCol = Math.max(maxCol, col);
    const x = HM.labelLeft + col * step;
    const y = HM.topBand + row * step;
    cells.push(
      `<rect class="tt-cell tt-l${level(d.seconds)}" x="${x}" y="${y}" width="${HM.cell}" height="${HM.cell}" rx="2">` +
        `<title>${esc(iso(d.date))}: ${hoursLabel(d.seconds)} h${commitsSuffix(d.commits)}</title></rect>`,
    );
    const month = date.getMonth();
    if (month !== lastMonth && row === 0) {
      months.push(`<text class="tt-axis-label" x="${x}" y="10">${MONTHS[month]}</text>`);
      lastMonth = month;
    }
  });

  const dayLabels = [
    [0, 'Mon'],
    [2, 'Wed'],
    [4, 'Fri'],
  ]
    .map(([r, t]) => `<text class="tt-axis-label" x="0" y="${HM.topBand + (r as number) * step + 9}">${t}</text>`)
    .join('');

  const width = HM.labelLeft + (maxCol + 1) * step - HM.gap + 2;
  const height = HM.topBand + 7 * step - HM.gap + 2;
  return (
    `<svg class="tt-chart tt-heatmap" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img">${months.join('')}${dayLabels}${cells.join('')}</svg>`
  );
}
