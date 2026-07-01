//@ts-check
// Webview = pure renderer. All geometry (SVG) and labels are computed on the extension host and
// sent via postMessage. Here we only inject markup. See docs/webview-design-rules.md.
(function () {
  // acquireVsCodeApi is injected by the VS Code webview runtime, ONCE per document.
  // @ts-ignore
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  // Kept from the last payload so the add-time form can be (re)built from the latest strings and
  // preset reasons without another round trip to the host.
  let lastStrings = /** @type {Record<string, string>} */ ({});
  let lastReasons = /** @type {string[]} */ ([]);

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
    lastStrings = s;
    lastReasons = Array.isArray(payload.manualReasons) ? payload.manualReasons : [];
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
      .map((/** @type {{ label?: string, date: string, hoursLabel?: string, commits: number, sessionsLabel?: string }} */ d) => {
        const sessions = d.sessionsLabel ? `<div class="tt-sessions">${esc(d.sessionsLabel)}</div>` : '';
        return (
          `<li class="tt-day-item${d.sessionsLabel ? ' tt-clickable' : ''}">` +
          `<div class="tt-day">` +
          `<span class="tt-day-date">${esc(d.label || d.date)}</span>` +
          `<span class="tt-day-right">` +
          `<span class="tt-day-commits">${esc(String(d.commits))} ${esc(s.commitsShort || 'commits')}</span>` +
          `<span class="tt-day-hours">${esc(d.hoursLabel || '')}</span>` +
          `</span>` +
          `</div>` +
          sessions +
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
      `<button id="tt-add" title="${esc(s.addEntry || 'Add time')}">+</button>` +
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
    const add = document.getElementById('tt-add');
    if (add) add.addEventListener('click', openAddForm);
    const settings = document.getElementById('tt-settings');
    if (settings) settings.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
    // Click a day with several sessions to expand its full breakdown (toggle the ellipsis off).
    app.querySelectorAll('.tt-clickable').forEach((li) =>
      li.addEventListener('click', () => li.classList.toggle('tt-expanded')),
    );
  }

  // Sentinel value of the "Other…" option, kept apart from any real reason.
  const OTHER = '__tt_other__';

  function todayLocal() {
    const d = new Date();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function closeAddForm() {
    const overlay = document.getElementById('tt-modal');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', onModalKey);
  }

  /** @param {KeyboardEvent} e */
  function onModalKey(e) {
    if (e.key === 'Escape') closeAddForm();
  }

  // Centered modal form inside the panel: all fields editable at once, with native date/time
  // pickers. Attached to <body> (not #app) so a background refresh that rebuilds #app leaves it open.
  function openAddForm() {
    closeAddForm(); // never stack two
    const s = lastStrings;
    const options =
      lastReasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('') +
      `<option value="${OTHER}">${esc(s.formOther || 'Other…')}</option>`;

    const overlay = document.createElement('div');
    overlay.id = 'tt-modal';
    overlay.className = 'tt-modal-backdrop';
    overlay.innerHTML =
      `<form class="tt-modal" id="tt-form">` +
      `<h2>${esc(s.addEntry || 'Add time')}</h2>` +
      `<label>${esc(s.formReason || 'Reason')}<select id="tt-f-reason">${options}</select></label>` +
      `<label id="tt-f-other-row" class="tt-hidden">${esc(s.formOtherReason || 'Custom reason')}` +
      `<input type="text" id="tt-f-other" maxlength="32" /></label>` +
      `<label>${esc(s.formDate || 'Date')}<input type="date" id="tt-f-date" value="${esc(todayLocal())}" /></label>` +
      `<div class="tt-modal-row">` +
      `<label>${esc(s.formStart || 'Start')}<input type="time" id="tt-f-start" /></label>` +
      `<label>${esc(s.formEnd || 'End')}<input type="time" id="tt-f-end" /></label>` +
      `</div>` +
      `<p class="tt-modal-error tt-hidden" id="tt-f-error"></p>` +
      `<div class="tt-modal-actions">` +
      `<button type="button" id="tt-f-cancel">${esc(s.formCancel || 'Cancel')}</button>` +
      `<button type="submit" id="tt-f-save">${esc(s.formSave || 'Save')}</button>` +
      `</div>` +
      `</form>`;
    document.body.appendChild(overlay);

    const reasonSel = /** @type {HTMLSelectElement} */ (document.getElementById('tt-f-reason'));
    const otherRow = document.getElementById('tt-f-other-row');
    const other = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-other'));
    // Show the free-text field only for "Other", and focus it so the now-required reason is filled.
    const syncOther = (/** @type {boolean} */ focusIt) => {
      const isOther = reasonSel.value === OTHER;
      if (otherRow) otherRow.classList.toggle('tt-hidden', !isOther);
      if (isOther && focusIt && other) other.focus();
    };
    reasonSel.addEventListener('change', () => syncOther(true));
    syncOther(false); // initial state (covers an empty preset list where "Other" is preselected)

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAddForm();
    });
    const cancel = document.getElementById('tt-f-cancel');
    if (cancel) cancel.addEventListener('click', closeAddForm);
    document.addEventListener('keydown', onModalKey);

    const form = document.getElementById('tt-form');
    if (form)
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitAddForm();
      });
    reasonSel.focus();
  }

  function submitAddForm() {
    const reasonSel = /** @type {HTMLSelectElement} */ (document.getElementById('tt-f-reason'));
    const other = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-other'));
    const date = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-date'));
    const start = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-start'));
    const end = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-end'));
    if (!reasonSel || !date || !start || !end) return;
    const reason = reasonSel.value === OTHER ? (other ? other.value.trim() : '') : reasonSel.value;
    // A custom reason is required: block right away instead of round-tripping to the host.
    if (reasonSel.value === OTHER && !reason) {
      showFormError(lastStrings.formReasonRequired || 'Enter a reason.');
      if (other) other.focus();
      return;
    }
    const save = /** @type {HTMLButtonElement} */ (document.getElementById('tt-f-save'));
    if (save) save.disabled = true;
    vscode.postMessage({ type: 'submitEntry', reason: reason, date: date.value, start: start.value, end: end.value });
  }

  /** @param {string} [message] */
  function showFormError(message) {
    const save = /** @type {HTMLButtonElement} */ (document.getElementById('tt-f-save'));
    if (save) save.disabled = false;
    const err = document.getElementById('tt-f-error');
    if (err) {
      err.textContent = message || '';
      err.classList.toggle('tt-hidden', !message);
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;
    if (message.type === 'history') render(message.payload);
    else if (message.type === 'entryError') showFormError(message.message);
    else if (message.type === 'entrySaved') closeAddForm();
  });

  // Tell the extension host the webview is ready to receive data.
  vscode.postMessage({ type: 'ready' });
})();
