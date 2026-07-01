// Adapter: reads the timeTracking settings and converts them into core units (ms).
import * as vscode from 'vscode';
import { truncateReason, normalizeReason } from '../core/manual-entry';
import type { ExportDateFormat, ExportColumn } from '../core/timesheet';

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
  readonly projectName: string; // display name for the {project} export token; empty = folder name
  readonly exportColumns: readonly ExportColumn[]; // "Name={template}" mapping, drives header + cells
  readonly exportSeparator: string; // joins the export columns
  readonly exportDateFormat: ExportDateFormat; // date preset used by the {date} token
  readonly defaultReason: string; // {reason} for untagged (plain editor) time
}

// Default columns of the exported CSV timesheet.
const DEFAULT_EXPORT_COLUMNS = ['Date={date}', 'Project={project}', 'Task=', 'Description={reason}', 'Quantity={hours}'];
const DATE_FORMATS: readonly ExportDateFormat[] = ['iso8601', 'rfc3339', 'rfc1123', 'rfc1123z', 'rfc850'];

// Each entry is "Name=template"; the first '=' splits them, so a template may itself contain '='.
function parseColumns(entries: readonly string[]): ExportColumn[] {
  return entries.map((e) => {
    const i = e.indexOf('=');
    return i < 0 ? { name: e, template: '' } : { name: e.slice(0, i), template: e.slice(i + 1) };
  });
}

// Sensible defaults for a manual entry's reason. Editable in settings; "Other" (free text) is always
// offered on top of these by the entry flow.
// Development leads (the common reason for time spent working in the editor) and is the preselected
// entry; the rest cover the usual non-coding activities.
const DEFAULT_MANUAL_REASONS = ['Development', 'Meeting', 'Code review', 'Planning', 'Documentation'];

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
    projectName: c.get<string>('projectName', '').trim(),
    exportColumns: parseColumns(c.get<string[]>('exportColumns', DEFAULT_EXPORT_COLUMNS)),
    exportSeparator: c.get<string>('exportSeparator', ','),
    exportDateFormat: readDateFormat(c.get<string>('exportDateFormat', 'iso8601')),
    defaultReason: normalizeReason(c.get<string>('defaultReason', 'Development')),
  };
}

function readDateFormat(value: string): ExportDateFormat {
  return (DATE_FORMATS as readonly string[]).includes(value) ? (value as ExportDateFormat) : 'iso8601';
}

export function onConfigChange(callback: (config: TimeTrackingConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('timeTracking')) return; // early return
    callback(readConfig());
  });
}
