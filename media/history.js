//@ts-check
// Webview = pure renderer. All geometry (SVG) and labels are computed on the extension host and
// sent via postMessage. Here we only inject markup. See docs/webview-design-rules.md.
(function () {
  // acquireVsCodeApi is injected by the VS Code webview runtime, ONCE per document.
  // @ts-ignore
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  /** @param {unknown} s @returns {string} */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function legendSvg() {
    const cell = 11;
    const step = 14;
    let cells = '';
    for (let i = 0; i < 5; i++) {
      cells += `<rect class="tt-cell tt-l${i}" x="${i * step}" y="0" width="${cell}" height="${cell}" rx="2"></rect>`;
    }
    const w = 5 * step - (step - cell);
    return `<svg width="${w}" height="${cell}" viewBox="0 0 ${w} ${cell}">${cells}</svg>`;
  }

  /** @param {any} payload */
  function render(payload) {
    // Apply the user's font-size setting (accessibility): the panel scales from it. 0 means defer
    // to the editor font size, so drop the override and let the stylesheet fall back.
    const fontSizePx = Number(payload.fontSizePx) || 0;
    document.body.style.fontSize = fontSizePx > 0 ? `${fontSizePx}px` : '';

    const s = payload.strings || {};
    const m = payload.months || {};
    const days = Array.isArray(payload.days) ? payload.days : [];

    // Last month first, then this month (side by side when the panel is wide enough).
    const lastMonthCard =
      `<div class="tt-badge">` +
      `<div class="tt-badge-label">${esc(s.lastMonth || 'Last month')}</div>` +
      `<div class="tt-badge-value">${esc(m.previousLabel || '0m')}</div>` +
      (m.variationText
        ? `<div class="tt-delta tt-${esc(m.variationDir || 'na')}">${esc(m.variationText)}</div>`
        : '') +
      `</div>`;
    const thisMonthCard =
      `<div class="tt-badge">` +
      `<div class="tt-badge-label">${esc(s.thisMonth || 'This month')}</div>` +
      `<div class="tt-badge-value">${esc(m.currentLabel || '0m')}</div>` +
      `</div>`;
    const badges = `<div class="tt-badges">${lastMonthCard}${thisMonthCard}</div>`;

    const trend = payload.trendSvg
      ? `<section class="tt-section"><h2>${esc(s.trend || 'Trend')}</h2>${payload.trendSvg}</section>`
      : '';

    const heatmap = payload.heatmapSvg
      ? `<section class="tt-section"><h2>${esc(s.calendar || 'Calendar')}</h2>${payload.heatmapSvg}` +
        `<div class="tt-legend"><span>${esc(s.less || 'Less')}</span>${legendSvg()}<span>${esc(s.more || 'More')}</span></div>` +
        `</section>`
      : '';

    const dayRows = days
      .map((/** @type {{ label?: string, date: string, hoursLabel?: string, commits: number, windowsLabel?: string }} */ d) => {
        const windows = d.windowsLabel ? `<div class="tt-windows">${esc(d.windowsLabel)}</div>` : '';
        return (
          `<li class="tt-day-item${d.windowsLabel ? ' tt-clickable' : ''}">` +
          `<div class="tt-day">` +
          `<span class="tt-day-date">${esc(d.label || d.date)}</span>` +
          `<span class="tt-day-right">` +
          `<span class="tt-day-commits">${esc(String(d.commits))} ${esc(s.commitsShort || 'commits')}</span>` +
          `<span class="tt-day-hours">${esc(d.hoursLabel || '')}</span>` +
          `</span>` +
          `</div>` +
          windows +
          `</li>`
        );
      })
      .join('');

    const dayList = days.length
      ? `<section class="tt-section"><h2>${esc(s.days || 'Days')}</h2><ul class="tt-days">${dayRows}</ul></section>`
      : `<p class="tt-empty">${esc(s.empty || 'No tracking data yet.')}</p>`;

    app.innerHTML =
      `<div class="tt-header">` +
      `<h1>${esc(s.history || 'History')}</h1>` +
      `<div class="tt-actions">` +
      `<button id="tt-refresh" title="${esc(s.refresh || 'Refresh')}">↻</button>` +
      `<button id="tt-settings" title="${esc(s.openSettings || 'Open settings')}">⚙</button>` +
      `</div>` +
      `</div>` +
      badges +
      trend +
      heatmap +
      dayList;

    const refresh = document.getElementById('tt-refresh');
    if (refresh) refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    const settings = document.getElementById('tt-settings');
    if (settings) settings.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
    // Click a day with several sessions to expand its full breakdown (toggle the ellipsis off).
    app.querySelectorAll('.tt-clickable').forEach((li) =>
      li.addEventListener('click', () => li.classList.toggle('tt-expanded')),
    );
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'history') render(message.payload);
  });

  // Tell the extension host the webview is ready to receive data.
  vscode.postMessage({ type: 'ready' });
})();
