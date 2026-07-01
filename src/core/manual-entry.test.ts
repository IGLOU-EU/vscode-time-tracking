import { describe, it, expect } from 'vitest';
import { parseHhMm, parseYmd, composeInterval, truncateReason, normalizeReason, MAX_REASON_LENGTH } from './manual-entry';

describe('parseHhMm', () => {
  it('parses a well-formed time into minutes since midnight', () => {
    expect(parseHhMm('00:00')).toBe(0);
    expect(parseHhMm('09:05')).toBe(9 * 60 + 5);
    expect(parseHhMm('23:59')).toBe(23 * 60 + 59);
  });

  it('accepts a single-digit hour and trims surrounding spaces', () => {
    expect(parseHhMm('9:30')).toBe(9 * 60 + 30);
    expect(parseHhMm('  9:30 ')).toBe(9 * 60 + 30);
  });

  it('rejects out-of-range, malformed or empty input', () => {
    expect(parseHhMm('')).toBeNull();
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('12:60')).toBeNull();
    expect(parseHhMm('12')).toBeNull();
    expect(parseHhMm('12h30')).toBeNull();
    expect(parseHhMm('ab:cd')).toBeNull();
  });
});

describe('parseYmd', () => {
  it('parses a valid calendar date', () => {
    expect(parseYmd('2026-07-01')).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it('rejects an impossible or malformed date', () => {
    expect(parseYmd('2026-13-01')).toBeNull();
    expect(parseYmd('2026-02-30')).toBeNull(); // not a real day
    expect(parseYmd('2026-7-1')).toBeNull(); // strict zero-padded form
    expect(parseYmd('01/07/2026')).toBeNull();
    expect(parseYmd('')).toBeNull();
  });
});

describe('composeInterval', () => {
  const ymd = { year: 2026, month: 7, day: 1 };

  it('builds a local interval from a date and two times', () => {
    const iv = composeInterval(ymd, 9 * 60, 11 * 60);
    expect(iv).toEqual({
      start: new Date(2026, 6, 1, 9, 0, 0, 0).getTime(),
      end: new Date(2026, 6, 1, 11, 0, 0, 0).getTime(),
    });
  });

  it('returns null when the end is not strictly after the start', () => {
    expect(composeInterval(ymd, 11 * 60, 9 * 60)).toBeNull();
    expect(composeInterval(ymd, 10 * 60, 10 * 60)).toBeNull();
  });
});

describe('truncateReason', () => {
  it('trims and caps at MAX_REASON_LENGTH without touching the casing', () => {
    expect(truncateReason('  meeting ')).toBe('meeting');
    expect(truncateReason('API design')).toBe('API design');
  });

  it('truncates a 36-char UUID to MAX_REASON_LENGTH', () => {
    const uuid = '76b9184d-c0c5-47d2-b42f-a9a469e49edb';
    expect(uuid.length).toBeGreaterThan(MAX_REASON_LENGTH);
    expect(truncateReason(uuid)).toBe(uuid.slice(0, MAX_REASON_LENGTH));
    expect(truncateReason(uuid)).toHaveLength(MAX_REASON_LENGTH);
  });
});

describe('normalizeReason', () => {
  it('trims and capitalizes the first letter', () => {
    expect(normalizeReason('  meeting ')).toBe('Meeting');
  });

  it('leaves the rest of the casing untouched (acronyms keep their capitals)', () => {
    expect(normalizeReason('API design')).toBe('API design');
    expect(normalizeReason('code Review')).toBe('Code Review');
  });

  it('caps the length at MAX_REASON_LENGTH characters', () => {
    const long = 'x'.repeat(50);
    expect(normalizeReason(long)).toHaveLength(MAX_REASON_LENGTH);
  });

  it('returns an empty string when nothing remains after trimming', () => {
    expect(normalizeReason('   ')).toBe('');
    expect(normalizeReason('')).toBe('');
  });
});
