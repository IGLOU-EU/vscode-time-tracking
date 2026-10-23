import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, window } from 'vscode';
import { createStatusView } from './status-bar';

const writableEnv = env as { language: string };
const editorLanguage = writableEnv.language;

describe('createStatusView in French', () => {
  let item: Record<string, unknown>;

  beforeEach(() => {
    writableEnv.language = 'fr';
    item = { show() {}, dispose() {} };
    vi.spyOn(window, 'createStatusBarItem').mockReturnValue(item as never);
  });

  afterEach(() => {
    writableEnv.language = editorLanguage;
    vi.restoreAllMocks();
  });

  it('reads a running session as one sentence of the display language', () => {
    createStatusView().showRunning('2h 05m', 'tooltip');
    expect(item.accessibilityInformation).toEqual({ label: 'Suivi en cours : 2h 05m' });
  });

  it('reads a pause once, as its label shows it', () => {
    createStatusView().showPaused('En pause (idle -5m)');
    expect(item.accessibilityInformation).toEqual({ label: 'En pause (idle -5m)' });
  });
});
