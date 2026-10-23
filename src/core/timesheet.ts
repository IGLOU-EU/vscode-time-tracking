// Pure core: render a month's tracked time into CSV-like lines through a simple {token} format.
// NO 'vscode' import. The adapter passes the day/session model (from buildDays), the user's line
// format, a date preset and the project name. This file does the token substitution and formatting.
// Time counting is already done upstream (cross-window union), so nothing here can double count.

import type { HistoryDay } from './history';
import { clockTime, durationHm, pad2 } from './activity';

/** One output row per contiguous session, or one row per description within each day. */
export const EXPORT_GRANULARITIES = ['session', 'day'] as const;
export type ExportGranularity = (typeof EXPORT_GRANULARITIES)[number];

/**
 * Date presets rendered in the machine's local time, following Go's standard layout constants.
 * `iso8601` is a bare date. The others are full timestamps carrying the local time and zone.
 */
export const EXPORT_DATE_FORMATS = ['iso8601', 'rfc3339', 'rfc1123', 'rfc1123z', 'rfc850'] as const;
export type ExportDateFormat = (typeof EXPORT_DATE_FORMATS)[number];

/** One output column: a name (used for the header row) and a {token} template for its cell value. */
export interface ExportColumn {
  readonly name: string;
  readonly template: string;
}

export interface TimesheetOptions {
  readonly granularity: ExportGranularity;
  readonly columns: readonly ExportColumn[];
  readonly separator: string; // joins the columns of a line (and the header); "" falls back to ","
  readonly dateFormat: ExportDateFormat;
  readonly project: string;
  readonly defaultReason: string; // {reason} value for a session that has none (e.g. plain editor time)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Local UTC offset of an instant, split for the various layouts.
function tzOffset(d: Date): { total: number; sign: string; hh: string; mm: string } {
  const total = -d.getTimezoneOffset(); // minutes east of UTC
  const abs = Math.abs(total);
  return { total, sign: total >= 0 ? '+' : '-', hh: pad2(Math.floor(abs / 60)), mm: pad2(abs % 60) };
}

const offsetRfc3339 = (d: Date): string => {
  const t = tzOffset(d);
  return t.total === 0 ? 'Z' : `${t.sign}${t.hh}:${t.mm}`;
};

const offsetNumeric = (d: Date): string => {
  const t = tzOffset(d);
  return `${t.sign}${t.hh}${t.mm}`;
};

// Short zone name (e.g. "CEST", or "GMT+2" where the runtime has no abbreviation), falling back to
// the numeric offset. This is the one part that depends on the host's Intl data.
function zoneAbbrev(d: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName');
    return part ? part.value : offsetNumeric(d);
  } catch {
    return offsetNumeric(d);
  }
}

/**
 * Format an instant per the chosen preset, in local time. The RFC presets always include the time
 * and zone. `iso8601` is a bare date unless `withTime` is set, in which case it appends the local
 * time (used by {date_start}/{date_end}, which are datetimes regardless of the preset).
 */
export function formatExportDate(ms: number, fmt: ExportDateFormat, withTime = false): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const mon = d.getMonth();
  const day = d.getDate();
  const dow = d.getDay();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  switch (fmt) {
    case 'rfc3339':
      return `${year}-${pad2(mon + 1)}-${pad2(day)}T${time}${offsetRfc3339(d)}`;
    case 'rfc1123':
      return `${WEEKDAYS[dow]}, ${pad2(day)} ${MONTHS[mon]} ${year} ${time} ${zoneAbbrev(d)}`;
    case 'rfc1123z':
      return `${WEEKDAYS[dow]}, ${pad2(day)} ${MONTHS[mon]} ${year} ${time} ${offsetNumeric(d)}`;
    case 'rfc850':
      return `${WEEKDAYS_FULL[dow]}, ${pad2(day)}-${MONTHS[mon]}-${pad2(year % 100)} ${time} ${zoneAbbrev(d)}`;
    case 'iso8601':
    default: {
      const date = `${year}-${pad2(mon + 1)}-${pad2(day)}`;
      return withTime ? `${date}T${time}` : date;
    }
  }
}

/** The raw values of one exported row, before formatting. The reason already includes the fallback. */
interface Row {
  startMs: number;
  endMs: number;
  ms: number;
  reason: string;
}

/**
 * Turn the day/session model into rows, per the chosen granularity. The sessions arrive from
 * buildDays already split by source (a manual reason labels exactly its own span), so a session
 * with no reason takes `defaultReason`. In `day` mode, sessions are grouped by that (effective)
 * reason when `byReason` is set: same-reason sessions merge into one row (summed time, spanning
 * start/end), different reasons stay separate, so a minority activity is not hidden in an all-day
 * total. When `byReason` is false (the output never shows the reason), the split would add
 * invisible distinctions, so touching pieces fold back into whole blocks and the whole day
 * collapses to a single row.
 */
export function buildTimesheetRows(
  days: readonly HistoryDay[],
  granularity: ExportGranularity,
  defaultReason: string,
  byReason: boolean,
): Row[] {
  const rows: Row[] = [];
  for (const d of days) {
    if (granularity === 'session') {
      for (const s of d.sessions) {
        const prev = rows[rows.length - 1];
        if (!byReason && prev && prev.endMs === s.start) {
          prev.endMs = s.end;
          prev.ms += s.end - s.start;
        } else {
          rows.push({ startMs: s.start, endMs: s.end, ms: s.end - s.start, reason: s.reason || defaultReason });
        }
      }
      continue;
    }
    if (d.sessions.length === 0) continue;

    if (!byReason) {
      const ms = d.sessions.reduce((sum, s) => sum + (s.end - s.start), 0);
      rows.push({ startMs: d.sessions[0].start, endMs: d.sessions[d.sessions.length - 1].end, ms, reason: defaultReason });
      continue;
    }

    const groups = new Map<string, { startMs: number; endMs: number; ms: number }>();
    for (const s of d.sessions) {
      const reason = s.reason || defaultReason;
      const g = groups.get(reason);
      if (g) {
        g.startMs = Math.min(g.startMs, s.start);
        g.endMs = Math.max(g.endMs, s.end);
        g.ms += s.end - s.start;
      } else {
        groups.set(reason, { startMs: s.start, endMs: s.end, ms: s.end - s.start });
      }
    }
    [...groups.entries()]
      .sort((a, b) => a[1].startMs - b[1].startMs)
      .forEach(([reason, g]) => rows.push({ ...g, reason }));
  }
  return rows;
}

// Values a {token} can resolve to. An absent token in the format is simply not used. An unknown
// token is left as-is so a typo stays visible rather than silently vanishing.
function rowTokens(row: Row, project: string, dateFormat: ExportDateFormat): Record<string, string> {
  return {
    project,
    // {date} follows the preset (a bare date for iso8601). {date_start}/{date_end} always carry the time.
    date: formatExportDate(row.startMs, dateFormat),
    date_start: formatExportDate(row.startMs, dateFormat, true),
    date_end: formatExportDate(row.endMs, dateFormat, true),
    start: clockTime(row.startMs),
    end: clockTime(row.endMs),
    total: durationHm(row.ms),
    hours: (row.ms / 3_600_000).toFixed(2),
    minutes: String(Math.round(row.ms / 60_000)),
    reason: row.reason,
  };
}

/** Substitute {token} occurrences in a line. Unknown tokens are left untouched. */
export function renderLine(format: string, tokens: Readonly<Record<string, string>>): string {
  return format.replace(/\{(\w+)\}/g, (whole, name: string) => (name in tokens ? tokens[name] : whole));
}

/**
 * Quote a field for a delimited file (RFC 4180): a value that contains the separator, a double
 * quote or a newline is wrapped in double quotes with interior quotes doubled, so it survives as a
 * single column. Plain values pass through unchanged.
 */
export function csvQuote(value: string, separator: string): string {
  return value.includes(separator) || value.includes('"') || /[\n\r]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/**
 * Render the whole timesheet. One line per row, ending with a trailing newline when non-empty so the
 * file is a well-formed text file. Returns "" when there is nothing to export.
 */
export function renderTimesheet(days: readonly HistoryDay[], opts: TimesheetOptions): string {
  // Only split a day by reason when a column actually renders the reason. Otherwise the extra rows
  // would differ by nothing visible.
  const byReason = opts.columns.some((c) => c.template.includes('{reason}'));
  const rows = buildTimesheetRows(days, opts.granularity, opts.defaultReason, byReason);
  if (rows.length === 0) return '';
  // The setting is free text: an empty separator would quote every cell (''.includes matches
  // anything) and join them with nothing, so it falls back to a comma.
  const sep = opts.separator || ',';
  const lines = rows.map((r) => {
    const tokens = rowTokens(r, opts.project, opts.dateFormat);
    return opts.columns.map((c) => csvQuote(renderLine(c.template, tokens), sep)).join(sep);
  });
  // Header row from the column names, unless every column is unnamed.
  if (opts.columns.some((c) => c.name.length > 0)) {
    lines.unshift(opts.columns.map((c) => csvQuote(c.name, sep)).join(sep));
  }
  return lines.join('\n') + '\n';
}
