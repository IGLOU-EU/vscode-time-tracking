// Performance bench for the history read+render path. NOT part of the unit suite
// (run with `npm run bench`; the test runner only picks up *.test.ts). It answers a
// concrete capacity question: what does opening the History panel cost when the store
// holds years of dense daily activity? Each "open" parses every JSONL line and rebuilds
// the whole view model from scratch (no cache), so this measures the realistic worst case.

import { bench, describe } from 'vitest';
import { buildHistoryModel, type TaggedInterval } from './history';
import { parseIntervals, serializeJsonl, toStoredInterval } from './jsonl';

const RECORDS_PER_DAY = 40;
const WINDOW_ID = 'w1';

// One day of dense activity: RECORDS_PER_DAY short, non-overlapping intervals laid out from
// 09:00, 12 minutes apart (so the day never crosses midnight and stays representative of a
// real workday split into many small focus blocks).
function dayIntervals(dayStartMs: number): TaggedInterval[] {
  const out: TaggedInterval[] = [];
  const firstBlock = dayStartMs + 9 * 3_600_000;
  for (let i = 0; i < RECORDS_PER_DAY; i++) {
    const start = firstBlock + i * 12 * 60_000;
    out.push({ windowId: WINDOW_ID, start, end: start + 10 * 60_000 });
  }
  return out;
}

// `years` worth of dense daily activity, ending today. Returns the tagged intervals (the in-memory
// shape readAllTagged produces) and the JSONL text on disk (what parseIntervals must chew through).
function makeFixture(years: number): { tagged: TaggedInterval[]; jsonl: string; commits: Record<string, number> } {
  const days = Math.round(years * 365);
  const base = new Date(2026, 5, 17, 0, 0, 0, 0).getTime() - (days - 1) * 86_400_000;
  const tagged: TaggedInterval[] = [];
  const commits: Record<string, number> = {};
  for (let d = 0; d < days; d++) {
    tagged.push(...dayIntervals(base + d * 86_400_000));
  }
  const jsonl = serializeJsonl(tagged.map((t) => toStoredInterval(t.windowId, { start: t.start, end: t.end })));
  return { tagged, jsonl, commits };
}

const NOW = new Date(2026, 5, 17, 18, 0, 0, 0).getTime();

// Build fixtures once so the cost is data crunching, not data generation.
const oneYear = makeFixture(1);
const fiveYears = makeFixture(5);
// What the build step actually receives once the read is bounded to the rendered window
// (heatmap 15 weeks + oldest badge month): ~16 weeks, regardless of total history length.
const windowed = makeFixture(16 / 52);

describe(`history read path (${RECORDS_PER_DAY} records/day)`, () => {
  // ~14.6k intervals: parse the on-disk JSONL into validated records.
  bench('parse JSONL — 1 year', () => {
    parseIntervals(oneYear.jsonl);
  });

  // ~73k intervals: the 5-year capacity question for parsing alone.
  bench('parse JSONL — 5 years', () => {
    parseIntervals(fiveYears.jsonl);
  });

  // Aggregate + per-window breakdown + 24h trend + 15-week heatmap from the in-memory intervals.
  bench('build history model — 1 year', () => {
    buildHistoryModel(oneYear.tagged, oneYear.commits, NOW);
  });

  bench('build history model — 5 years', () => {
    buildHistoryModel(fiveYears.tagged, fiveYears.commits, NOW);
  });

  // Post guard-rail: the build only ever sees the rendered window, so this is the real recurring
  // cost when the panel is kept open, whatever the history length behind it.
  bench('build history model — windowed (~16 weeks)', () => {
    buildHistoryModel(windowed.tagged, windowed.commits, NOW);
  });

  // End to end: parse from disk then build the model, i.e. one full panel open.
  bench('full panel open (parse + build) — 5 years', () => {
    const records = parseIntervals(fiveYears.jsonl);
    const tagged = records.map((r) => ({ windowId: r.windowId, start: r.start, end: r.end }));
    buildHistoryModel(tagged, fiveYears.commits, NOW);
  });
});
