import { describe, it, expect } from 'vitest';
import { formatExportDate, renderLine, csvQuote, buildTimesheetRows, renderTimesheet } from './timesheet';
import type { HistoryDay } from './history';

const at = (y: number, mo1: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, mo1 - 1, d, hh, mm, 0, 0).getTime();

// July 1, 2026 is a Wednesday. 09:05 local anchors the zoned-format assertions.
const DAY = at(2026, 7, 1);
const MOMENT = at(2026, 7, 1, 9, 5);

const dayModel = (
  date: string,
  sessions: HistoryDay['sessions'],
  seconds: number,
  manual: HistoryDay['manual'] = [],
): HistoryDay => ({
  date,
  seconds,
  commits: 0,
  sessions,
  windows: [],
  manual,
});

describe('formatExportDate', () => {
  // The date and time parts are timezone-independent (built and read in the same local zone). Only
  // the trailing offset/zone varies by machine, so those are matched loosely.
  it('renders a bare ISO 8601 date, or a datetime when the time is requested', () => {
    expect(formatExportDate(DAY, 'iso8601')).toBe('2026-07-01');
    expect(formatExportDate(MOMENT, 'iso8601', true)).toBe('2026-07-01T09:05:00');
  });

  it('renders RFC 3339 with the local time and offset', () => {
    expect(formatExportDate(MOMENT, 'rfc3339')).toMatch(/^2026-07-01T09:05:00(Z|[+-]\d{2}:\d{2})$/);
  });

  it('renders RFC 1123 with the local time and a zone', () => {
    expect(formatExportDate(MOMENT, 'rfc1123')).toMatch(/^Wed, 01 Jul 2026 09:05:00 .+$/);
  });

  it('renders RFC 1123 with a numeric zone offset (rfc1123z)', () => {
    expect(formatExportDate(MOMENT, 'rfc1123z')).toMatch(/^Wed, 01 Jul 2026 09:05:00 [+-]\d{4}$/);
  });

  it('renders an RFC 850 style timestamp', () => {
    expect(formatExportDate(MOMENT, 'rfc850')).toMatch(/^Wednesday, 01-Jul-26 09:05:00 .+$/);
  });
});

describe('renderLine', () => {
  it('substitutes known tokens and leaves unknown ones untouched', () => {
    const tokens = { project: 'Acme', date: '2026-07-01' };
    expect(renderLine('{project};{date};{missing}', tokens)).toBe('Acme;2026-07-01;{missing}');
  });

  it('ignores tokens the format does not use', () => {
    expect(renderLine('{date}', { project: 'Acme', date: '2026-07-01' })).toBe('2026-07-01');
  });
});

describe('csvQuote', () => {
  it('leaves a plain value untouched', () => {
    expect(csvQuote('Development', ',')).toBe('Development');
  });

  it('wraps a value containing the separator', () => {
    expect(csvQuote('Meeting, Review', ',')).toBe('"Meeting, Review"');
  });

  it('wraps and doubles interior quotes and newlines', () => {
    expect(csvQuote('a"b', ',')).toBe('"a""b"');
    expect(csvQuote('a\nb', ',')).toBe('"a\nb"');
  });
});

describe('buildTimesheetRows', () => {
  it('emits one row per session', () => {
    const days = [
      dayModel(
        '20260701',
        [
          { start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 11) },
          { start: at(2026, 7, 1, 14), end: at(2026, 7, 1, 15), reason: 'Meeting' },
        ],
        3 * 3600,
        [{ start: at(2026, 7, 1, 14), end: at(2026, 7, 1, 15), reason: 'Meeting' }],
      ),
    ];
    const rows = buildTimesheetRows(days, 'session', 'Development', true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reason: 'Development' }); // untagged session takes the default
    expect(rows[1]).toMatchObject({ ms: 3_600_000, reason: 'Meeting' });
  });

  const mixedDay = [
    dayModel(
      '20260701',
      [
        { start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 12) }, // untagged -> Development, 3h
        { start: at(2026, 7, 1, 13), end: at(2026, 7, 1, 15), reason: 'Conference' }, // 2h
        { start: at(2026, 7, 1, 15), end: at(2026, 7, 1, 17) }, // untagged -> Development, 2h
      ],
      7 * 3600,
      [{ start: at(2026, 7, 1, 13), end: at(2026, 7, 1, 15), reason: 'Conference' }],
    ),
  ];

  it('per day (byReason), groups by reason: same-reason sessions merge, distinct reasons stay separate', () => {
    const rows = buildTimesheetRows(mixedDay, 'day', 'Development', true);
    expect(rows).toHaveLength(2);
    // Sorted by first start: Development (09:00) then Conference (13:00).
    expect(rows[0]).toMatchObject({ reason: 'Development', ms: 5 * 3_600_000, startMs: at(2026, 7, 1, 9), endMs: at(2026, 7, 1, 17) });
    expect(rows[1]).toMatchObject({ reason: 'Conference', ms: 2 * 3_600_000, startMs: at(2026, 7, 1, 13), endMs: at(2026, 7, 1, 15) });
  });

  it('per day (not byReason), collapses the whole day to a single row', () => {
    const rows = buildTimesheetRows(mixedDay, 'day', 'Development', false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ms: 7 * 3_600_000, startMs: at(2026, 7, 1, 9), endMs: at(2026, 7, 1, 17) });
  });

  it('skips days without any session', () => {
    expect(buildTimesheetRows([dayModel('20260701', [], 0)], 'session', 'Development', true)).toEqual([]);
    expect(buildTimesheetRows([dayModel('20260701', [], 0)], 'day', 'Development', true)).toEqual([]);
  });

  // Per-source attribution: a manual entry's reason applies to its own span only, never to the
  // auto-tracked time merged into the same block.
  const overlapDay = (manual: HistoryDay['manual']) => [
    dayModel(
      '20260701',
      [{ start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 12), reason: 'Meeting' }], // merged auto 9-11 + manual 10-12
      3 * 3600,
      manual,
    ),
  ];

  it('attributes only its own span to a manual entry overlapping auto time (session granularity)', () => {
    const manual = [{ start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 12), reason: 'Meeting' }];
    const rows = buildTimesheetRows(overlapDay(manual), 'session', 'Development', true);
    expect(rows).toEqual([
      { startMs: at(2026, 7, 1, 9), endMs: at(2026, 7, 1, 10), ms: 3_600_000, reason: 'Development' },
      { startMs: at(2026, 7, 1, 10), endMs: at(2026, 7, 1, 12), ms: 2 * 3_600_000, reason: 'Meeting' },
    ]);
  });

  it('attributes only its own span to a manual entry overlapping auto time (day granularity)', () => {
    const manual = [{ start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 12), reason: 'Meeting' }];
    const rows = buildTimesheetRows(overlapDay(manual), 'day', 'Development', true);
    expect(rows).toEqual([
      { startMs: at(2026, 7, 1, 9), endMs: at(2026, 7, 1, 10), ms: 3_600_000, reason: 'Development' },
      { startMs: at(2026, 7, 1, 10), endMs: at(2026, 7, 1, 12), ms: 2 * 3_600_000, reason: 'Meeting' },
    ]);
  });

  it('splits around a manual entry in the middle of a block', () => {
    const days = [
      dayModel(
        '20260701',
        [{ start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 17), reason: 'Meeting' }],
        8 * 3600,
        [{ start: at(2026, 7, 1, 12), end: at(2026, 7, 1, 12, 30), reason: 'Meeting' }],
      ),
    ];
    const rows = buildTimesheetRows(days, 'session', 'Development', true);
    expect(rows.map((r) => [r.reason, r.ms / 60_000])).toEqual([
      ['Development', 180],
      ['Meeting', 30],
      ['Development', 270],
    ]);
  });

  it('merges adjacent same-reason manual spans into one row', () => {
    const days = [
      dayModel(
        '20260701',
        [{ start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 12), reason: 'Meeting' }],
        3 * 3600,
        [
          { start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 11), reason: 'Meeting' },
          { start: at(2026, 7, 1, 11), end: at(2026, 7, 1, 12), reason: 'Meeting' },
        ],
      ),
    ];
    const rows = buildTimesheetRows(days, 'session', 'Development', true);
    expect(rows).toEqual([
      { startMs: at(2026, 7, 1, 9), endMs: at(2026, 7, 1, 10), ms: 3_600_000, reason: 'Development' },
      { startMs: at(2026, 7, 1, 10), endMs: at(2026, 7, 1, 12), ms: 2 * 3_600_000, reason: 'Meeting' },
    ]);
  });

  it('joins overlapping manual reasons on their overlap only', () => {
    const days = [
      dayModel(
        '20260701',
        [{ start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 13), reason: 'Meeting, Review' }],
        4 * 3600,
        [
          { start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 12), reason: 'Meeting' },
          { start: at(2026, 7, 1, 11), end: at(2026, 7, 1, 13), reason: 'Review' },
        ],
      ),
    ];
    const rows = buildTimesheetRows(days, 'session', 'Development', true);
    expect(rows.map((r) => r.reason)).toEqual(['Development', 'Meeting', 'Meeting, Review', 'Review']);
    expect(rows.map((r) => r.ms)).toEqual([3_600_000, 3_600_000, 3_600_000, 3_600_000]);
  });

  it('keeps whole blocks when byReason is false (no reason rendered, no invisible split)', () => {
    const manual = [{ start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 12), reason: 'Meeting' }];
    const rows = buildTimesheetRows(overlapDay(manual), 'session', 'Development', false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startMs: at(2026, 7, 1, 9), endMs: at(2026, 7, 1, 12), ms: 3 * 3_600_000 });
  });
});

describe('renderTimesheet', () => {
  const days = [
    dayModel(
      '20260701',
      [
        { start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10, 30) },
        { start: at(2026, 7, 1, 14), end: at(2026, 7, 1, 15), reason: 'Meeting' },
      ],
      2.5 * 3600,
      [{ start: at(2026, 7, 1, 14), end: at(2026, 7, 1, 15), reason: 'Meeting' }],
    ),
  ];

  const cols = (...pairs: Array<[string, string]>) => pairs.map(([name, template]) => ({ name, template }));

  const BASE = {
    granularity: 'session' as const,
    columns: cols(['Date', '{date}'], ['Project', '{project}'], ['Task', ''], ['Description', '{reason}'], ['Quantity', '{hours}']),
    separator: ',',
    dateFormat: 'iso8601' as const,
    project: 'Acme',
    defaultReason: 'Development',
  };

  it('emits a header row from the column names, then one line per session', () => {
    const csv = renderTimesheet(days, BASE);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Project,Task,Description,Quantity');
    // Untagged session falls back to the default reason, the tagged one keeps its own.
    expect(lines[1]).toBe('2026-07-01,Acme,,Development,1.50');
    expect(lines[2]).toBe('2026-07-01,Acme,,Meeting,1.00');
  });

  it('omits the header when every column is unnamed', () => {
    const csv = renderTimesheet(days, { ...BASE, columns: cols(['', '{hours}']) });
    expect(csv).toBe('1.50\n1.00\n');
  });

  it('exposes {date_start} and {date_end} as full timestamps of the session bounds', () => {
    const csv = renderTimesheet(days, {
      ...BASE,
      columns: cols(['', '{date_start}'], ['', '{date_end}']),
      separator: '|',
      dateFormat: 'rfc3339',
    });
    expect(csv.split('\n')[0]).toMatch(/^2026-07-01T09:00:00\S+\|2026-07-01T10:30:00\S+$/);
  });

  it('keeps the time in {date_start}/{date_end} even when the preset is a bare date (iso8601)', () => {
    const csv = renderTimesheet(days, {
      ...BASE,
      columns: cols(['', '{date}'], ['', '{date_start}'], ['', '{date_end}']),
      separator: '|',
      dateFormat: 'iso8601',
    });
    expect(csv.split('\n')[0]).toBe('2026-07-01|2026-07-01T09:00:00|2026-07-01T10:30:00');
  });

  it('per day, splits by reason only when a column renders {reason}', () => {
    const dayOpts = { ...BASE, granularity: 'day' as const };
    const withReason = renderTimesheet(days, { ...dayOpts, columns: cols(['', '{date}'], ['', '{reason}'], ['', '{hours}']) });
    // Two sessions, two reasons (untagged -> Development, and Meeting) -> two rows.
    expect(withReason).toBe('2026-07-01,Development,1.50\n2026-07-01,Meeting,1.00\n');
    const withoutReason = renderTimesheet(days, { ...dayOpts, columns: cols(['', '{date}'], ['', '{hours}']) });
    // No {reason} column -> one row for the whole day (2.5h).
    expect(withoutReason).toBe('2026-07-01,2.50\n');
  });

  it('quotes a cell whose value contains the separator', () => {
    const span = { start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10), reason: 'Meeting, Review' };
    const withComma = [dayModel('20260701', [span], 3600, [span])];
    const csv = renderTimesheet(withComma, { ...BASE, columns: cols(['', '{reason}'], ['', '{hours}']) });
    expect(csv).toBe('"Meeting, Review",1.00\n');
  });

  it('exports the auto time around a manual entry under the default reason, not the entry reason', () => {
    const overlap = [
      dayModel(
        '20260701',
        [{ start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 12), reason: 'Meeting' }],
        3 * 3600,
        [{ start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 12), reason: 'Meeting' }],
      ),
    ];
    const csv = renderTimesheet(overlap, { ...BASE, granularity: 'day', columns: cols(['', '{reason}'], ['', '{hours}']) });
    expect(csv).toBe('Development,1.00\nMeeting,2.00\n');
  });

  it('falls back to a comma when the configured separator is empty', () => {
    // An empty separator would quote every cell (''.includes matches anything) and join them with
    // nothing, an unparseable file. The render must stay a well-formed delimited file.
    const csv = renderTimesheet(days, { ...BASE, separator: '', columns: cols(['', '{date}'], ['', '{hours}']) });
    expect(csv).toBe('2026-07-01,1.50\n2026-07-01,1.00\n');
  });

  it('returns an empty string (no header either) when there is nothing to export', () => {
    expect(renderTimesheet([dayModel('20260701', [], 0)], BASE)).toBe('');
  });
});
