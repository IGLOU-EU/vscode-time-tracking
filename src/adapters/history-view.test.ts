import { afterEach, describe, expect, it } from 'vitest';
import { env, type Uri, type WebviewView } from 'vscode';
import { HistoryViewProvider, type HistoryDataPort } from './history-view';

// Only what resolveWebviewView touches: the page is built, nothing is posted yet.
function fakeView() {
  const none = () => ({ dispose() {} });
  return {
    webview: {
      options: {},
      html: '',
      cspSource: 'webview-source',
      asWebviewUri: () => ({ with: () => 'asset-uri' }),
      onDidReceiveMessage: none,
    },
    onDidChangeVisibility: none,
    onDidDispose: none,
  };
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
    new HistoryViewProvider({} as Uri, {} as HistoryDataPort).resolveWebviewView(view as unknown as WebviewView);
    expect(view.webview.html).toContain('<html lang="fr">');
  });
});
