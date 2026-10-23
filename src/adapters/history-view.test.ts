import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, env, type Uri, type WebviewView } from 'vscode';
import { HistoryViewProvider, type ExportOpen, type HistoryDataPort, type HistoryPayload } from './history-view';
import type { Logger } from './logger';

// Only what the provider touches: the page is built, posts are recorded, receive() plays a
// message from the page, and setVisible() what the editor does on a hide or a show.
function fakeView(visible = true) {
  const none = () => ({ dispose() {} });
  const posted: unknown[] = [];
  let visibilityChanged = (): void => undefined;
  const view = {
    posted,
    receive: (_message: unknown): void => undefined,
    setVisible: (next: boolean): void => {
      view.visible = next;
      visibilityChanged();
    },
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
    onDidChangeVisibility: (listener: () => void) => {
      visibilityChanged = listener;
      return { dispose() {} };
    },
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

describe('HistoryViewProvider forms opened by a command', () => {
  const payload = { todayHours: 0, strings: { hoursToday: '' } } as unknown as HistoryPayload;
  const open: ExportOpen = { months: [], defaultMonth: null, defaultPath: 'timesheet.csv' };
  const data: Partial<HistoryDataPort> = {
    buildPayload: () => Promise.resolve(payload),
    getExportOpen: () => Promise.resolve(open),
  };
  const typesPosted = (view: ReturnType<typeof fakeView>) => view.posted.map((m) => (m as { type: string }).type);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reveals the history view first', async () => {
    const run = vi.spyOn(commands, 'executeCommand');
    await providerFor(fakeView(), data).showAddForm();
    expect(run).toHaveBeenCalledWith('timeTracking.historyView.focus');
  });

  it('opens the add-time form of a page that has drawn the history', async () => {
    const view = fakeView();
    const provider = providerFor(view, data);
    view.receive({ type: 'ready' });
    await settle();
    await provider.showAddForm();
    expect(typesPosted(view)).toEqual(['history', 'openAddForm']);
  });

  it('opens the add-time form once the page the reveal loads has drawn the history', async () => {
    // The reveal resolves before the new page has loaded, and a message posted then is lost. The
    // form is built from the strings of the history, so it waits for those too.
    const view = fakeView();
    const provider = providerFor(view, data);
    await provider.showAddForm();
    expect(view.posted).toEqual([]);
    view.receive({ type: 'ready' });
    await settle();
    expect(typesPosted(view)).toEqual(['history', 'openAddForm']);
  });

  it('opens the add-time form of a view the reveal shows for the first time', async () => {
    const view = fakeView();
    const provider = new HistoryViewProvider({} as Uri, data as HistoryDataPort, { log() {} });
    vi.spyOn(commands, 'executeCommand').mockImplementation(() => {
      provider.resolveWebviewView(view as unknown as WebviewView);
      return Promise.resolve(undefined);
    });
    await provider.showAddForm();
    view.receive({ type: 'ready' });
    await settle();
    expect(typesPosted(view)).toEqual(['history', 'openAddForm']);
  });

  it('waits for a new page once the view was hidden, as the hidden one is freed', async () => {
    const view = fakeView();
    const provider = providerFor(view, data);
    view.receive({ type: 'ready' });
    await settle();
    view.setVisible(false);
    view.posted.length = 0;
    vi.spyOn(commands, 'executeCommand').mockImplementation(() => {
      view.setVisible(true);
      return Promise.resolve(undefined);
    });
    await provider.showAddForm();
    await settle();
    expect(typesPosted(view)).toEqual(['history']);
    view.receive({ type: 'ready' });
    await settle();
    expect(typesPosted(view)).toEqual(['history', 'history', 'openAddForm']);
  });

  it('opens the export form once the page the reveal loads has drawn the history', async () => {
    const view = fakeView();
    const provider = providerFor(view, data);
    await provider.showExportForm();
    view.receive({ type: 'ready' });
    await settle();
    expect(view.posted.slice(1)).toEqual([{ type: 'exportOpen', ...open }]);
  });
});
