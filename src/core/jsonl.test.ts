import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  parseJsonl,
  serializeLine,
  serializeJsonl,
  isStoredInterval,
  parseIntervals,
  toStoredInterval,
  type StoredInterval,
} from './jsonl';

describe('parseJsonl', () => {
  it('returns an empty array for an empty string', () => {
    expect(parseJsonl('')).toEqual([]);
  });

  it('parses multiple lines', () => {
    expect(parseJsonl('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('ignores empty lines and whitespace', () => {
    expect(parseJsonl('\n  \n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it('ignores a truncated last line (crash mid-write)', () => {
    expect(parseJsonl('{"a":1}\n{"b":2}\n{"c":')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('ignores an invalid line in the middle without losing the following ones', () => {
    expect(parseJsonl('{"a":1}\nPAS_DU_JSON\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('serializeLine / serializeJsonl', () => {
  it('serializeLine appends a newline', () => {
    expect(serializeLine({ a: 1 })).toBe('{"a":1}\n');
  });

  it('serializeJsonl equals the empty string for no entries', () => {
    expect(serializeJsonl([])).toBe('');
  });

  it('round trip: parseJsonl(serializeJsonl(x)) == x', () => {
    const rows = [{ a: 1 }, { b: 'deux' }, { c: [3, 4] }];
    expect(parseJsonl(serializeJsonl(rows))).toEqual(rows);
  });
});

describe('isStoredInterval', () => {
  it('accepts a well-formed record', () => {
    const rec: StoredInterval = { v: SCHEMA_VERSION, windowId: 'w1', start: 10, end: 20 };
    expect(isStoredInterval(rec)).toBe(true);
  });

  it('rejects a record with missing or mistyped fields', () => {
    expect(isStoredInterval({ v: 1, windowId: 'w1', start: 10 })).toBe(false);
    expect(isStoredInterval({ v: 1, windowId: 5, start: 10, end: 20 })).toBe(false);
    expect(isStoredInterval(null)).toBe(false);
    expect(isStoredInterval('x')).toBe(false);
  });

  it('rejects an interval whose end precedes its start', () => {
    expect(isStoredInterval({ v: 1, windowId: 'w1', start: 20, end: 10 })).toBe(false);
  });
});

describe('parseIntervals', () => {
  it('keeps only the valid records', () => {
    const text =
      serializeLine({ v: 1, windowId: 'w1', start: 0, end: 100 }) +
      serializeLine({ v: 1, windowId: 'w2', start: 50, end: 200 }) +
      'LIGNE_CORROMPUE\n' +
      serializeLine({ foo: 'bar' });
    expect(parseIntervals(text)).toEqual([
      { v: 1, windowId: 'w1', start: 0, end: 100 },
      { v: 1, windowId: 'w2', start: 50, end: 200 },
    ]);
  });
});

describe('toStoredInterval', () => {
  it('stamps the schema version and the windowId', () => {
    expect(toStoredInterval('w7', { start: 5, end: 9 })).toEqual({
      v: SCHEMA_VERSION,
      windowId: 'w7',
      start: 5,
      end: 9,
    });
  });
});
