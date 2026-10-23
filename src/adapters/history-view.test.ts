import { afterEach, describe, expect, it } from 'vitest';
import { env, type Uri, type WebviewView } from 'vscode';
import { HistoryViewProvider, type HistoryDataPort, type HistoryPayload } from './history-view';

// Only what the provider touches: the page is built, and posts are recorded.
function fakeView(visible = true) {
  const none = () => ({ dispose() {} });
  const posted: unknown[] = [];
  return {
    posted,
    visible,
    badge: undefined as unknown,
    webview: {
      options: {},
      html: '',
      cspSource: 'webview-source',
      asWebviewUri: () => ({ with: () => 'asset-uri' }),
      onDidReceiveMessage: none,
      postMessage: (message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
    onDidChangeVisibility: none,
    onDidDispose: none,
  };
}

function providerFor(view: ReturnType<typeof fakeView>, data: Partial<HistoryDataPort> = {}): HistoryViewProvider {
  const provider = new HistoryViewProvider({} as Uri, data as HistoryDataPort);
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
});
