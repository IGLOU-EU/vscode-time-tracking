// Pure core: the messages the History page posts to the host, read as untrusted input. NO 'vscode'
// import. A message carries what the user typed (a manual entry, an export path), so it is rebuilt
// from the fields its type expects, each of the right type, and anything else is dropped.
import { EXPORT_GRANULARITIES, type ExportGranularity } from './timesheet';

/** Raw field values from the add-time form, validated by the core on the host side. */
export interface ManualEntryInput {
  reason: string;
  date: string;
  start: string;
  end: string;
}

/** The chosen export parameters submitted from the modal. */
export interface ExportRequest {
  month: string;
  granularity: ExportGranularity;
  path: string;
}

/** The messages with no field: page loaded, and the clicks the host answers. */
const SIGNALS = ['ready', 'refresh', 'openSettings', 'openExport', 'openMonths'] as const;

export type FromPage =
  | { type: (typeof SIGNALS)[number] }
  | ({ type: 'submitEntry' } & ManualEntryInput)
  | { type: 'exportBrowse'; path: string }
  | ({ type: 'exportRun' } & ExportRequest);

const isText = (value: unknown): value is string => typeof value === 'string';
const isSignal = (value: unknown): value is (typeof SIGNALS)[number] => (SIGNALS as readonly unknown[]).includes(value);
const isGranularity = (value: unknown): value is ExportGranularity =>
  (EXPORT_GRANULARITIES as readonly unknown[]).includes(value);

/** What the page sent, as a typed message, or undefined when it is not one the page sends. */
export function fromPage(message: unknown): FromPage | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const fields = message as Record<string, unknown>;
  const { type } = fields;
  if (isSignal(type)) return { type };
  if (type === 'submitEntry') {
    const { reason, date, start, end } = fields;
    return isText(reason) && isText(date) && isText(start) && isText(end)
      ? { type, reason, date, start, end }
      : undefined;
  }
  if (type === 'exportBrowse') {
    const { path } = fields;
    return isText(path) ? { type, path } : undefined;
  }
  if (type === 'exportRun') {
    const { month, granularity, path } = fields;
    return isText(month) && isGranularity(granularity) && isText(path) ? { type, month, granularity, path } : undefined;
  }
  return undefined;
}
