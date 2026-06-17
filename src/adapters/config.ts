// Adapter: reads the timeTracking settings and converts them into core units (ms).
import * as vscode from 'vscode';

export interface TimeTrackingConfig {
  readonly idleThresholdMs: number;
  readonly backgroundTimeoutMs: number;
  readonly focusCapMs: number;
  readonly debugIdleCapMs: number;
  readonly minSessionMs: number;
  readonly gitUserEmail: string;
  readonly debugLogging: boolean;
}

export function readConfig(): TimeTrackingConfig {
  const c = vscode.workspace.getConfiguration('timeTracking');
  return {
    idleThresholdMs: c.get<number>('inactivityThresholdMinutes', 30) * 60_000,
    backgroundTimeoutMs: c.get<number>('backgroundProcessTimeoutMinutes', 30) * 60_000,
    focusCapMs: c.get<number>('focusedIdleCapMinutes', 60) * 60_000,
    debugIdleCapMs: c.get<number>('debugIdleCapHours', 0) * 3_600_000,
    minSessionMs: c.get<number>('minSessionMinutes', 1) * 60_000,
    gitUserEmail: c.get<string>('gitUserEmail', '').trim(),
    debugLogging: c.get<boolean>('debugLogging', false),
  };
}

export function onConfigChange(callback: (config: TimeTrackingConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('timeTracking')) return; // early return
    callback(readConfig());
  });
}
