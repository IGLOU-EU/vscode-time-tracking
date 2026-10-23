// Adapter: the activity-bar webview that shows the history. The webview is a pure renderer:
// the extension host computes everything (SVG, labels) and sends it via postMessage. Without
// retainContextWhenHidden, we only post to a visible view and re-push on visibility/refresh.
import * as vscode from 'vscode';
import { fromPage, type ExportRequest, type ManualEntryInput } from '../core/page-message';
import type { Logger } from './logger';

export interface HistoryPayload {
  trendSvg: string;
  heatmapSvg: string;
  months: {
    currentLabel: string;
    previousLabel: string;
    variationText: string;
    variationDir: 'up' | 'down' | 'flat' | 'na';
  };
  days: Array<{
    date: string;
    label: string;
    hoursLabel: string;
    commitsLabel: string; // agreed with the count, e.g. "1 commit"
    sessionsLabel?: string;
  }>;
  strings: Record<string, string>;
  manualReasons: string[]; // preset reasons for the add-time form
  todayHours: number;
  fontSizePx: number; // base font size for the panel in px. 0 = follow the editor font size
}

/** The months page opened from the last month badge: the project total, then one card per month. */
export interface MonthsPayload {
  totalLabel: string;
  months: Array<{ label: string; hoursLabel: string }>;
}

/** A selectable month in the export modal. */
export interface ExportMonth {
  value: string; // YYYYMM
  label: string; // localized, e.g. "July 2026"
  fileName: string; // suggested output file name, so the path can follow the selection
}

/** What the export modal needs when it opens: the available months and a proposed file path. */
export interface ExportOpen {
  months: ExportMonth[];
  defaultMonth: string | null; // preselected value, null when no data
  defaultPath: string;
}

export interface HistoryDataPort {
  buildPayload(): Promise<HistoryPayload>;
  /** Totals over the whole history, read only when the months page asks for them. */
  buildMonths(): Promise<MonthsPayload>;
  /** Validate and store a manual entry. Returns a localized error message, or null on success. */
  submitManualEntry(input: ManualEntryInput): Promise<string | null>;
  /** Gather the months with data and a default output path for the export modal. */
  getExportOpen(): Promise<ExportOpen>;
  /** Native save dialog seeded with `suggestedPath`. Returns the chosen path, or null if cancelled. */
  browseExportPath(suggestedPath: string): Promise<string | null>;
  /** Write the timesheet. Returns a localized error message, or null on success. */
  runExport(request: ExportRequest): Promise<string | null>;
}

export class HistoryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'timeTracking.historyView'; // must match contributes.views id

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly data: HistoryDataPort,
    private readonly logger: Pick<Logger, 'log'>,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview);

    const sub = view.webview.onDidReceiveMessage((raw: unknown) => {
      const msg = fromPage(raw);
      if (!msg) {
        // Only a bug of the page gets here: say which message, never act on it.
        const type = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : raw;
        this.logger.log('page-message-ignored', { type: typeof type === 'string' ? type : typeof type });
        return;
      }
      if (msg.type === 'ready' || msg.type === 'refresh') {
        void this.refresh();
        return;
      }
      if (msg.type === 'submitEntry') {
        const { reason, date, start, end } = msg;
        void this.data
          .submitManualEntry({ reason, date, start, end })
          .then((error) => {
            // Tell the form to show the error and stay open, or to close on success.
            void this.view?.webview.postMessage({ type: error ? 'entryError' : 'entrySaved', message: error });
          })
          .catch((e: unknown) => {
            // A rejected save (disk full, read-only storage) must not leave the button disabled.
            const message = vscode.l10n.t('Saving failed: {error}', { error: errorText(e) });
            void this.view?.webview.postMessage({ type: 'entryError', message });
          });
        return;
      }
      if (msg.type === 'openSettings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'timeTracking');
        return;
      }
      if (msg.type === 'openExport') {
        void this.data
          .getExportOpen()
          .then((open) => {
            void this.view?.webview.postMessage({ type: 'exportOpen', ...open });
          })
          .catch((e: unknown) => {
            // The modal only opens on the reply, so a silent rejection would make the click do nothing.
            void vscode.window.showErrorMessage(vscode.l10n.t('Could not open the export form: {error}', { error: errorText(e) }));
          });
        return;
      }
      if (msg.type === 'openMonths') {
        void this.data
          .buildMonths()
          .then((payload) => {
            void this.view?.webview.postMessage({ type: 'months', payload });
          })
          .catch((e: unknown) => {
            // The page only opens on the reply, so a silent rejection would make the click do nothing.
            void vscode.window.showErrorMessage(vscode.l10n.t('Could not load the months: {error}', { error: errorText(e) }));
          });
        return;
      }
      if (msg.type === 'exportBrowse') {
        void this.data
          .browseExportPath(msg.path)
          .then((path) => {
            if (path !== null) void this.view?.webview.postMessage({ type: 'exportPath', path });
          })
          .catch((e: unknown) => {
            void vscode.window.showErrorMessage(vscode.l10n.t('Could not open the save dialog: {error}', { error: errorText(e) }));
          });
        return;
      }
      if (msg.type === 'exportRun') {
        const { month, granularity, path } = msg;
        void this.data
          .runExport({ month, granularity, path })
          .then((error) => {
            void this.view?.webview.postMessage({ type: error ? 'exportError' : 'exportDone', message: error });
          })
          .catch((e: unknown) => {
            // Same contract as a returned error: show it in the form and unlock the Export button.
            const message = vscode.l10n.t('Export failed: {error}', { error: errorText(e) });
            void this.view?.webview.postMessage({ type: 'exportError', message });
          });
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.refresh();
    });
    view.onDidDispose(() => {
      sub.dispose();
      this.view = undefined;
    });
  }

  // Push fresh data to the webview and its badge. The badge shows on the activity bar while the
  // view is out of sight, so a hidden view gets it too, and only the page waits until it is shown.
  // A view never shown has no WebviewView yet, so it has no badge to set.
  async refresh(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const payload = await this.data.buildPayload();
    if (this.view !== view) return; // disposed while building, and a disposed view throws
    if (view.visible) void view.webview.postMessage({ type: 'history', payload });
    const todayHours = Math.round(payload.todayHours);
    // The template is already translated: looked up again, it would be a key no bundle holds.
    view.badge = { value: todayHours, tooltip: payload.strings.hoursToday.replaceAll('{count}', String(todayHours)) };
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    // Bust any webview-side cache of the assets: a stale history.js/css can otherwise survive a
    // window reload, serving an old build. The nonce is fresh on every html build (so every reload).
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'history.js')).with({ query: `v=${nonce}` });
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'history.css')).with({ query: `v=${nonce}` });
    // Codicon font (vendored from @vscode/codicons) for the native toolbar icons.
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'codicon.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${codiconUri}" rel="stylesheet" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>${vscode.l10n.t('History')}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// Human-readable text of a rejection value, for the localized error messages above.
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
