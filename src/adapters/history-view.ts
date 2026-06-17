// Adapter: the activity-bar webview that shows the history. The webview is a pure renderer:
// the extension host computes everything (SVG, labels) and sends it via postMessage. Without
// retainContextWhenHidden, we only post to a visible view and re-push on visibility/refresh.
import * as vscode from 'vscode';

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
    commits: number;
    windowsLabel?: string;
  }>;
  strings: Record<string, string>;
  todayHours: number;
  fontSizePx: number; // base font size for the panel in px. 0 = follow the editor font size
}

export interface HistoryDataPort {
  buildPayload(): Promise<HistoryPayload>;
}

type InboundMessage = { type: 'ready' | 'refresh' | 'openSettings' };

export class HistoryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'timeTracking.historyView'; // must match contributes.views id

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly data: HistoryDataPort,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview);

    const sub = view.webview.onDidReceiveMessage((msg: InboundMessage) => {
      if (msg.type === 'ready' || msg.type === 'refresh') {
        void this.refresh();
        return;
      }
      if (msg.type === 'openSettings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'timeTracking');
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

  // Push fresh data to the webview. No-op unless the view exists and is visible.
  async refresh(): Promise<void> {
    const view = this.view;
    if (!view || !view.visible) return;
    const payload = await this.data.buildPayload();
    void view.webview.postMessage({ type: 'history', payload });
    view.badge = { value: Math.round(payload.todayHours), tooltip: payload.strings.hoursToday ?? '' };
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'history.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'history.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
