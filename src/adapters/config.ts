// Adapter: reads the timeTracking settings and converts them into core units (ms).
import * as vscode from 'vscode';
import { truncateReason } from '../core/manual-entry';

export interface TimeTrackingConfig {
  readonly idleThresholdMs: number;
  readonly backgroundTimeoutMs: number;
  readonly focusCapMs: number;
  readonly debugIdleCapMs: number;
  readonly minSessionMs: number;
  readonly fontSizePx: number; // History panel base font size in px. 0 = follow the editor font size
  readonly gitUserEmail: string;
  readonly debugLogging: boolean;
  readonly manualReasons: readonly string[]; // preset reasons offered when adding time by hand
}

// Sensible defaults for a manual entry's reason. Editable in settings; "Other" (free text) is always
// offered on top of these by the entry flow.
const DEFAULT_MANUAL_REASONS = ['Meeting', 'Code review', 'Planning', 'Documentation', 'Support'];

export function readConfig(): TimeTrackingConfig {
  const c = vscode.workspace.getConfiguration('timeTracking');
  const idleThresholdMs = c.get<number>('inactivityThresholdMinutes', 30) * 60_000;
  // The focus cap doubles as the unfocused idle cap and must outlast the out-grace, so the grace
  // window is well-formed. 0 keeps its "disabled" meaning, any positive value is raised to the
  // threshold.
  const rawFocusCapMs = c.get<number>('focusedIdleCapMinutes', 60) * 60_000;
  return {
    idleThresholdMs,
    backgroundTimeoutMs: c.get<number>('backgroundProcessTimeoutMinutes', 30) * 60_000,
    focusCapMs: rawFocusCapMs > 0 ? Math.max(rawFocusCapMs, idleThresholdMs) : 0,
    debugIdleCapMs: c.get<number>('debugIdleCapHours', 0) * 3_600_000,
    minSessionMs: c.get<number>('minSessionMinutes', 1) * 60_000,
    fontSizePx: c.get<number>('fontSize', 14),
    gitUserEmail: c.get<string>('gitUserEmail', '').trim(),
    debugLogging: c.get<boolean>('debugLogging', false),
    // Truncate each preset as the setting is ingested, so the list shown is never over-long even
    // before the stored setting is rewritten. Capitalization is applied later, when a time entry is
    // saved, not to the user's setting value.
    manualReasons: c.get<string[]>('manualReasons', DEFAULT_MANUAL_REASONS).map(truncateReason).filter(Boolean),
  };
}

export function onConfigChange(callback: (config: TimeTrackingConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('timeTracking')) return; // early return
    callback(readConfig());
  });
}
