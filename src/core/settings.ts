// Pure core: validate the timeTracking settings and convert them into core units (ms). NO 'vscode'
// import. A value written by hand in settings.json reaches the extension whatever its type, the
// editor only flags it, so this read is what keeps every setting usable.

import { normalizeReason, truncateReason } from './manual-entry';
import { EXPORT_DATE_FORMATS, type ExportColumn, type ExportDateFormat } from './timesheet';

export interface Settings {
  readonly idleThresholdMs: number;
  readonly backgroundTimeoutMs: number;
  readonly focusCapMs: number;
  readonly debugIdleCapMs: number;
  readonly minSessionMs: number;
  readonly fontSizePx: number; // History panel base font size in px. 0 = follow the editor font size
  readonly gitUserEmail: string;
  readonly debugLogging: boolean;
  readonly manualReasons: readonly string[]; // preset reasons offered when adding time by hand
  readonly projectName: string; // display name for the {project} export token, empty = folder name
  readonly exportColumns: readonly ExportColumn[]; // "Name={template}" mapping, drives header + cells
  readonly exportSeparator: string; // joins the export columns
  readonly exportDateFormat: ExportDateFormat; // date preset used by the {date} token
  readonly defaultReason: string; // {reason} for untagged (plain editor) time
}

/** Reads one raw setting by its key inside the timeTracking section. */
export type SettingReader = (key: string) => unknown;

/**
 * The minimum and maximum the manifest declares for each number setting. The editor exposes a
 * setting's default but not its bounds, hence this copy, held equal to package.json by
 * manifest.test.ts.
 */
export const NUMBER_BOUNDS = {
  inactivityThresholdMinutes: { minimum: 1 },
  backgroundProcessTimeoutMinutes: { minimum: 1 },
  focusedIdleCapMinutes: { minimum: 0 },
  debugIdleCapHours: { minimum: 0 },
  minSessionMinutes: { minimum: 0 },
  fontSize: { minimum: 0, maximum: 72 },
} as const;

interface Bounds {
  readonly minimum: number;
  readonly maximum?: number;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isDateFormat = (v: unknown): v is ExportDateFormat => (EXPORT_DATE_FORMATS as readonly unknown[]).includes(v);

/**
 * Build the settings from the raw values. A value of the wrong type is replaced by `fallback`, the
 * manifest default, and a number outside its bounds is clamped to them, as the editor does for its
 * own numeric options (EditorIntOption.clampedInt in src/vs/editor/common/config/editorOptions.ts).
 */
export function normalizeSettings(value: SettingReader, fallback: SettingReader): Settings {
  // manifest.test.ts proves that every default passes its own check, so the fallback is not checked.
  const pick = <T>(key: string, valid: (v: unknown) => v is T): T => {
    const v = value(key);
    return valid(v) ? v : (fallback(key) as T);
  };
  const num = (key: keyof typeof NUMBER_BOUNDS): number => {
    const { minimum, maximum = Number.POSITIVE_INFINITY }: Bounds = NUMBER_BOUNDS[key];
    return Math.min(Math.max(pick(key, isFiniteNumber), minimum), maximum);
  };

  const idleThresholdMs = num('inactivityThresholdMinutes') * 60_000;
  // The focus cap doubles as the unfocused idle cap and must outlast the out-grace, so the grace
  // window is well-formed. 0 keeps its "disabled" meaning, any positive value is raised to the
  // threshold.
  const focusCapMs = num('focusedIdleCapMinutes') * 60_000;
  return {
    idleThresholdMs,
    backgroundTimeoutMs: num('backgroundProcessTimeoutMinutes') * 60_000,
    focusCapMs: focusCapMs > 0 ? Math.max(focusCapMs, idleThresholdMs) : 0,
    debugIdleCapMs: num('debugIdleCapHours') * 3_600_000,
    minSessionMs: num('minSessionMinutes') * 60_000,
    fontSizePx: num('fontSize'),
    gitUserEmail: pick('gitUserEmail', isString).trim(),
    debugLogging: pick('debugLogging', isBoolean),
    // Truncate each preset as it is ingested: the stored setting is never rewritten (the schema's
    // maxLength only warns), this read is what enforces the cap. Capitalization is applied later,
    // when a time entry is saved, not to the setting.
    manualReasons: pick('manualReasons', isStringList).map(truncateReason).filter(Boolean),
    projectName: pick('projectName', isString).trim(),
    exportColumns: parseColumns(pick('exportColumns', isStringList)),
    exportSeparator: pick('exportSeparator', isString),
    exportDateFormat: pick('exportDateFormat', isDateFormat),
    defaultReason: normalizeReason(pick('defaultReason', isString)),
  };
}

// Each entry is "Name=template". The first '=' splits them, so a template may itself contain '='.
function parseColumns(entries: readonly string[]): ExportColumn[] {
  return entries.map((e) => {
    const i = e.indexOf('=');
    return i < 0 ? { name: e, template: '' } : { name: e.slice(0, i), template: e.slice(i + 1) };
  });
}
