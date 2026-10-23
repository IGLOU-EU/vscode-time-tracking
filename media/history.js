// Webview = pure renderer. All geometry (SVG) and labels are computed on the extension host and
// sent via postMessage. Here we only inject markup. See docs/webview-design-rules.md.
(function () {
  // acquireVsCodeApi is injected by the VS Code webview runtime, ONCE per document (webview.d.ts).
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  // Kept from the last payload so the add-time form can be (re)built from the latest strings and
  // preset reasons without another round trip to the host.
  let lastStrings = /** @type {Record<string, string>} */ ({});
  let lastReasons = /** @type {string[]} */ ([]);
  // The months page replaces the main view until Back. The last history payload is kept so Back
  // redraws the main view without a round trip.
  let lastHistory = /** @type {any} */ (null);
  let monthsShown = false;
  // The days the user expanded, by date. The webview state keeps them across a refresh, which
  // rebuilds the list every minute, and across the reload of a page the hidden view freed.
  const saved = /** @type {{ expanded?: unknown } | undefined} */ (vscode.getState());
  let expanded = new Set(Array.isArray(saved?.expanded) ? saved.expanded.filter((d) => typeof d === 'string') : []);

  // Quotes included: esc() also feeds double-quoted attribute values (option/input `value="..."`),
  // where an unescaped quote would truncate the value and inject stray attributes.
  /** @param {unknown} s @returns {string} */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    /** @type {Array<{ date: string, label?: string, hoursLabel?: string, commitsLabel?: string, sessionsLabel?: string }>} */
    const days = Array.isArray(payload.days) ? payload.days : [];

    // Last month first, then this month (side by side when the panel is wide enough). The last
    // month badge opens the months page, as a focusable button so the keyboard reaches it too.
    const lastMonthCard =
      `<div id="tt-months" class="tt-badge tt-badge-link" role="button" tabindex="0" title="${esc(s.allMonths || 'Show all months')}">` +
      `<div class="tt-badge-label">${esc(s.lastMonth || 'Last month')}</div>` +
      `<div class="tt-badge-value">${esc(m.previousLabel || '0m')}</div>` +
      (m.variationText
        ? `<div class="tt-delta tt-${esc(m.variationDir || 'na')}">${esc(m.variationText)}</div>`
        : '') +
      `<i class="codicon codicon-search" aria-hidden="true"></i>` +
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
      .map((d) => {
        const sessions = d.sessionsLabel ? `<div class="tt-sessions">${esc(d.sessionsLabel)}</div>` : '';
        const rowClass = d.sessionsLabel ? (expanded.has(d.date) ? ' tt-clickable tt-expanded' : ' tt-clickable') : '';
        return (
          `<li class="tt-day-item${rowClass}" data-date="${esc(d.date)}">` +
          `<div class="tt-day">` +
          `<span class="tt-day-date">${esc(d.label || d.date)}</span>` +
          `<span class="tt-day-right">` +
          `<span class="tt-day-commits">${esc(d.commitsLabel || '')}</span>` +
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
      `<button id="tt-add" title="${esc(s.addEntry || 'Add time')}"><i class="codicon codicon-add"></i></button>` +
      `<button id="tt-export" title="${esc(s.exportTitle || 'Export timesheet')}"><i class="codicon codicon-export"></i></button>` +
      `<button id="tt-refresh" title="${esc(s.refresh || 'Refresh')}"><i class="codicon codicon-refresh"></i></button>` +
      `<button id="tt-settings" title="${esc(s.openSettings || 'Open settings')}"><i class="codicon codicon-settings-gear"></i></button>` +
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
    const exportBtn = document.getElementById('tt-export');
    if (exportBtn) exportBtn.addEventListener('click', () => vscode.postMessage({ type: 'openExport' }));
    const settings = document.getElementById('tt-settings');
    if (settings) settings.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
    const months = document.getElementById('tt-months');
    if (months) {
      months.addEventListener('click', () => vscode.postMessage({ type: 'openMonths' }));
      months.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        vscode.postMessage({ type: 'openMonths' });
      });
    }
    // Click a day with several sessions to expand its full breakdown (toggle the ellipsis off).
    app.querySelectorAll('.tt-clickable').forEach((li) =>
      li.addEventListener('click', () => {
        const open = li.classList.toggle('tt-expanded');
        const date = li.getAttribute('data-date');
        // Saved among the days shown, so the state never outgrows the list.
        expanded = new Set(days.map((d) => d.date).filter((d) => (d === date ? open : expanded.has(d))));
        vscode.setState({ expanded: [...expanded] });
      }),
    );
  }

  /** @param {{ totalLabel?: string, months?: Array<{ label?: string, hoursLabel?: string }> }} payload */
  function renderMonths(payload) {
    const s = lastStrings;
    const months = Array.isArray(payload.months) ? payload.months : [];
    /** @param {string} label @param {string} value */
    const card = (label, value) =>
      `<div class="tt-badge">` +
      `<div class="tt-badge-label">${esc(label)}</div>` +
      `<div class="tt-badge-value">${esc(value)}</div>` +
      `</div>`;

    app.innerHTML =
      `<div class="tt-header">` +
      `<h1>${esc(s.months || 'Months')}</h1>` +
      `<div class="tt-actions">` +
      `<button id="tt-back" title="${esc(s.back || 'Back')}"><i class="codicon codicon-arrow-left"></i></button>` +
      `</div>` +
      `</div>` +
      `<div class="tt-badges">${card(s.total || 'Total', payload.totalLabel || '0m')}</div>` +
      `<div class="tt-badges">${months.map((m) => card(m.label || '', m.hoursLabel || '0m')).join('')}</div>`;

    const back = document.getElementById('tt-back');
    if (back) {
      back.addEventListener('click', () => {
        monthsShown = false;
        if (lastHistory) render(lastHistory);
      });
    }
  }

  // Sentinel value of the "Other…" option, kept apart from any real reason.
  const OTHER = '__tt_other__';

  function todayLocal() {
    const d = new Date();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // The add-time and export forms share the modal id and plumbing: only one modal is ever open.
  function closeModal() {
    const overlay = document.getElementById('tt-modal');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', onModalKey);
  }

  /** @param {KeyboardEvent} e */
  function onModalKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  // Cancel button, backdrop click and Escape all dismiss the modal.
  /** @param {HTMLElement} overlay @param {string} cancelId */
  function wireModalDismiss(overlay, cancelId) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    const cancel = document.getElementById(cancelId);
    if (cancel) cancel.addEventListener('click', closeModal);
    document.addEventListener('keydown', onModalKey);
  }

  // Show (or clear) a modal's error line and re-enable its submit button, so a reported failure
  // never leaves the form locked.
  /** @param {string} buttonId @param {string} errorId @param {string} [message] */
  function showModalError(buttonId, errorId, message) {
    const button = /** @type {HTMLButtonElement} */ (document.getElementById(buttonId));
    if (button) button.disabled = false;
    const err = document.getElementById(errorId);
    if (err) {
      err.textContent = message || '';
      err.classList.toggle('tt-hidden', !message);
    }
  }

  // Editing a field makes a shown validation error stale and confusing: hide it until the next
  // submit (the submit button state is left alone).
  /** @param {HTMLElement} form @param {string} errorId */
  function clearErrorOnEdit(form, errorId) {
    const clear = () => {
      const err = document.getElementById(errorId);
      if (err) err.classList.add('tt-hidden');
    };
    form.addEventListener('input', clear);
    form.addEventListener('change', clear);
  }

  // Centered modal form inside the panel: all fields editable at once, with native date/time
  // pickers. Attached to <body> (not #app) so a background refresh that rebuilds #app leaves it open.
  function openAddForm() {
    closeModal(); // never stack two
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
      `<p class="tt-modal-hint tt-hidden" id="tt-f-nextday"></p>` +
      `<p class="tt-modal-error tt-hidden" id="tt-f-error"></p>` +
      `<div class="tt-modal-actions">` +
      `<button type="button" id="tt-f-cancel" class="tt-btn tt-btn-secondary">${esc(s.formCancel || 'Cancel')}</button>` +
      `<button type="submit" id="tt-f-save" class="tt-btn tt-btn-primary">${esc(s.formSave || 'Save')}</button>` +
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

    // An end at or before the start rolls over to the next day (night session). Deliberate, but a
    // swapped start/end would silently store a huge entry, so surface the rollover and its length
    // before Save.
    const startIn = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-start'));
    const endIn = /** @type {HTMLInputElement} */ (document.getElementById('tt-f-end'));
    const nextDay = document.getElementById('tt-f-nextday');
    const minutesOf = (/** @type {string} */ v) => {
      const m = /^(\d{2}):(\d{2})$/.exec(v);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const syncNextDay = () => {
      if (!nextDay || !startIn || !endIn) return;
      const start = minutesOf(startIn.value);
      const end = minutesOf(endIn.value);
      const rolls = start !== null && end !== null && end < start;
      if (rolls) {
        const total = 24 * 60 - start + end;
        const tpl = s.formNextDay || 'Ends the next day ({hours}h {minutes}m).';
        nextDay.textContent = tpl
          .replace('{hours}', String(Math.floor(total / 60)))
          .replace('{minutes}', String(total % 60).padStart(2, '0'));
      }
      nextDay.classList.toggle('tt-hidden', !rolls);
    };
    startIn.addEventListener('input', syncNextDay);
    endIn.addEventListener('input', syncNextDay);

    wireModalDismiss(overlay, 'tt-f-cancel');

    const form = document.getElementById('tt-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitAddForm();
      });
      clearErrorOnEdit(form, 'tt-f-error');
    }
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
    showModalError('tt-f-save', 'tt-f-error', message);
  }

  // Export modal: month + granularity + output path, all editable at once. Shares the modal id and
  // styles with the add form (only one modal is ever open).
  /** @param {{months?: Array<{value: string, label: string, fileName: string}>, defaultMonth?: string | null, defaultPath?: string}} open */
  function openExportForm(open) {
    closeModal();
    const s = lastStrings;
    const months = Array.isArray(open.months) ? open.months : [];
    const overlay = document.createElement('div');
    overlay.id = 'tt-modal';
    overlay.className = 'tt-modal-backdrop';

    if (months.length === 0) {
      overlay.innerHTML =
        `<div class="tt-modal">` +
        `<h2>${esc(s.exportTitle || 'Export timesheet')}</h2>` +
        `<p class="tt-modal-error">${esc(s.exportEmpty || 'No data to export yet.')}</p>` +
        `<div class="tt-modal-actions"><button type="button" id="tt-x-cancel" class="tt-btn tt-btn-secondary">${esc(s.formCancel || 'Cancel')}</button></div>` +
        `</div>`;
      document.body.appendChild(overlay);
      wireModalDismiss(overlay, 'tt-x-cancel');
      return;
    }

    const monthOptions = months
      .map((m) => `<option value="${esc(m.value)}"${m.value === open.defaultMonth ? ' selected' : ''}>${esc(m.label)}</option>`)
      .join('');
    overlay.innerHTML =
      `<form class="tt-modal" id="tt-x-form">` +
      `<h2>${esc(s.exportTitle || 'Export timesheet')}</h2>` +
      `<label>${esc(s.exportMonth || 'Month')}<select id="tt-x-month">${monthOptions}</select></label>` +
      `<label>${esc(s.exportGranularity || 'Rows')}<select id="tt-x-gran">` +
      `<option value="day">${esc(s.exportPerDay || 'Per day')}</option>` +
      `<option value="session">${esc(s.exportPerSession || 'Per session')}</option>` +
      `</select></label>` +
      `<label>${esc(s.exportFile || 'File')}` +
      `<span class="tt-modal-file"><input type="text" id="tt-x-path" value="${esc(open.defaultPath || '')}" />` +
      `<button type="button" id="tt-x-browse" class="tt-btn tt-btn-secondary">${esc(s.exportBrowse || 'Choose…')}</button></span></label>` +
      `<p class="tt-modal-error tt-hidden" id="tt-x-error"></p>` +
      `<div class="tt-modal-actions">` +
      `<button type="button" id="tt-x-cancel" class="tt-btn tt-btn-secondary">${esc(s.formCancel || 'Cancel')}</button>` +
      `<button type="submit" id="tt-x-run" class="tt-btn tt-btn-primary">${esc(s.exportRun || 'Export')}</button>` +
      `</div>` +
      `</form>`;
    document.body.appendChild(overlay);
    wireModalDismiss(overlay, 'tt-x-cancel');

    const browse = document.getElementById('tt-x-browse');
    const pathInput = /** @type {HTMLInputElement} */ (document.getElementById('tt-x-path'));
    if (browse) browse.addEventListener('click', () => vscode.postMessage({ type: 'exportBrowse', path: pathInput ? pathInput.value : '' }));

    // The suggested file name follows the month selection, but a name the user customized is
    // never clobbered (it no longer matches the last auto-set one).
    const monthSel = /** @type {HTMLSelectElement} */ (document.getElementById('tt-x-month'));
    let autoName = months.find((m) => m.value === monthSel.value)?.fileName || 'timesheet.csv';
    monthSel.addEventListener('change', () => {
      const next = months.find((m) => m.value === monthSel.value)?.fileName;
      if (!next || !pathInput) return;
      const val = pathInput.value;
      const cut = Math.max(val.lastIndexOf('/'), val.lastIndexOf('\\')) + 1;
      if (val.slice(cut) === autoName) pathInput.value = val.slice(0, cut) + next;
      autoName = next;
    });

    const form = document.getElementById('tt-x-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitExportForm();
      });
      clearErrorOnEdit(form, 'tt-x-error');
    }
  }

  function submitExportForm() {
    const month = /** @type {HTMLSelectElement} */ (document.getElementById('tt-x-month'));
    const gran = /** @type {HTMLSelectElement} */ (document.getElementById('tt-x-gran'));
    const pathInput = /** @type {HTMLInputElement} */ (document.getElementById('tt-x-path'));
    if (!month || !gran || !pathInput || !pathInput.value.trim()) {
      showExportError(lastStrings.exportPathRequired || 'Enter a file path.');
      return;
    }
    const run = /** @type {HTMLButtonElement} */ (document.getElementById('tt-x-run'));
    if (run) run.disabled = true;
    // The select only offers the two granularities, and the host checks the value again.
    const granularity = /** @type {import('../src/core/timesheet').ExportGranularity} */ (gran.value);
    vscode.postMessage({ type: 'exportRun', month: month.value, granularity, path: pathInput.value.trim() });
  }

  /** @param {string} [message] */
  function showExportError(message) {
    showModalError('tt-x-run', 'tt-x-error', message);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;
    if (message.type === 'history') {
      lastHistory = message.payload;
      // While the months page is shown, refresh it rather than replacing it with the main view.
      if (monthsShown) vscode.postMessage({ type: 'openMonths' });
      else render(message.payload);
    } else if (message.type === 'months') {
      monthsShown = true;
      renderMonths(message.payload);
    } else if (message.type === 'entryError') showFormError(message.message);
    else if (message.type === 'entrySaved') closeModal();
    else if (message.type === 'exportOpen') openExportForm(message);
    else if (message.type === 'exportPath') {
      const pathInput = /** @type {HTMLInputElement} */ (document.getElementById('tt-x-path'));
      if (pathInput) pathInput.value = message.path;
      // A programmatic fill fires no input event, so hide a stale empty-path error here too.
      const err = document.getElementById('tt-x-error');
      if (err) err.classList.add('tt-hidden');
    } else if (message.type === 'exportError') showExportError(message.message);
    else if (message.type === 'exportDone') closeModal();
  });

  // Tell the extension host the webview is ready to receive data.
  vscode.postMessage({ type: 'ready' });
})();
