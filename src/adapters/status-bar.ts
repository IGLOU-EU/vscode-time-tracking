// Adapter: the single status bar item. Created once, then mutated. Three states:
// running (clock), paused (warning background), and "no tracking" (idle).
import * as vscode from 'vscode';

export interface StatusView {
  showRunning(elapsed: string, tooltipMarkdown: string): void;
  showPending(label: string): void;
  showPaused(label: string): void;
  showIdle(): void;
  dispose(): void;
}

export function createStatusView(): StatusView {
  const item = vscode.window.createStatusBarItem(
    'timeTracking.session',
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.name = vscode.l10n.t('Time Tracking');
  item.command = 'timeTracking.toggle'; // click toggles pause/resume; history opens from the activity bar
  item.show();

  // State colors via the text color (backgroundColor only honors warning/error): green while
  // tracking, orange while awaiting confirmation or paused, red when idle.
  const green = new vscode.ThemeColor('charts.green');
  const orange = new vscode.ThemeColor('charts.orange');
  const red = new vscode.ThemeColor('charts.red');

  return {
    showRunning(elapsed, tooltipMarkdown) {
      item.text = `$(clock) ${elapsed}`;
      item.tooltip = new vscode.MarkdownString(tooltipMarkdown);
      item.backgroundColor = undefined;
      item.color = green;
      item.accessibilityInformation = { label: vscode.l10n.t('Tracking: {elapsed}', { elapsed }) };
    },
    showPending(label) {
      item.text = `$(watch) ${label}`;
      item.tooltip = label;
      item.backgroundColor = undefined;
      item.color = orange;
      item.accessibilityInformation = { label };
    },
    showPaused(label) {
      item.text = `$(debug-pause) ${label}`;
      item.tooltip = label;
      item.backgroundColor = undefined;
      item.color = orange;
      item.accessibilityInformation = { label }; // the label already starts with the paused state
    },
    showIdle() {
      const label = vscode.l10n.t('No tracking');
      item.text = `$(circle-slash) ${label}`;
      item.tooltip = undefined;
      item.backgroundColor = undefined;
      item.color = red;
      item.accessibilityInformation = { label: vscode.l10n.t('Time tracking: no tracking') };
    },
    dispose() {
      item.dispose();
    },
  };
}
