import { afterEach, describe, expect, it } from 'vitest';
import { env, type Uri, type WebviewView } from 'vscode';
import { HistoryViewProvider, type HistoryDataPort, type HistoryPayload } from './history-view';
import type { Logger } from './logger';

// Only what the provider touches: the page is built, posts are recorded, and receive() plays a
// message from the page.
function fakeView(visible = true) {
  const none = () => ({ dispose() {} });
  const posted: unknown[] = [];
  const view = {
    posted,
    receive: (_message: unknown): void => undefined,
    visible,
    badge: undefined as unknown,
    webview: {
      options: {},
      html: '',
      cspSource: 'webview-source',
      asWebviewUri: () => ({ with: () => 'asset-uri' }),
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        view.receive = listener;
        return { dispose() {} };
      },
      postMessage: (message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
    onDidChangeVisibility: none,
    onDidDispose: none,
  };
  return view;
}

function providerFor(
  view: ReturnType<typeof fakeView>,
  data: Partial<HistoryDataPort> = {},
  logger: Pick<Logger, 'log'> = { log() {} },
): HistoryViewProvider {
  const provider = new HistoryViewProvider({} as Uri, data as HistoryDataPort, logger);
  provider.resolveWebviewView(view as unknown as WebviewView);
  return provider;
}

const writableEnv = env as { language: string };
const editorLanguage = writableEnv.language;

describe('HistoryViewProvider', () => {
  afterEach(() => {
    writableEnv.language = editorLanguage;
  });

  it('declares the editor display language on the page', () => {
    writableEnv.language = 'fr';
    const view = fakeView();
    providerFor(view);
    expect(view.webview.html).toContain('<html lang="fr">');
  });

  it('keeps the badge of a hidden view up to date, without posting to its page', async () => {
    // The badge shows on the activity bar precisely while the view is out of sight.
    const view = fakeView(false);
    const payload: Pick<HistoryPayload, 'todayHours' | 'strings'> = {
      todayHours: 2.6,
      strings: { hoursToday: '{count} hours tracked today' },
    };
    await providerFor(view, { buildPayload: () => Promise.resolve(payload as HistoryPayload) }).refresh();
    expect(view.badge).toEqual({ value: 3, tooltip: '3 hours tracked today' });
    expect(view.posted).toEqual([]);
  });

  it('ignores a malformed message from the page, with a line in the debug log', () => {
    const view = fakeView();
    const exports: unknown[] = [];
    const lines: unknown[] = [];
    const runExport = (request: unknown) => (exports.push(request), Promise.resolve(null));
    providerFor(view, { runExport }, { log: (event, data) => lines.push([event, data]) });
    view.receive({ type: 'exportRun', month: '202610', granularity: 'week', path: 'october.csv' });
    expect(exports).toEqual([]);
    expect(lines).toEqual([['page-message-ignored', { type: 'exportRun' }]]);
  });
});
