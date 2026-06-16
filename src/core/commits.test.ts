import { describe, it, expect } from 'vitest';
import { countMyCommitsForDay, localDayBounds, type CommitRecord } from './commits';

const MY = 'adrien@iglou.eu';
const bounds = localDayBounds(2026, 5, 16); // June 16, 2026 (month0 = 5)
const dt = (hh: number, mm = 0): Date => new Date(2026, 5, 16, hh, mm, 0, 0);

function commit(overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    hash: 'h',
    authorEmail: MY,
    authorDate: dt(10),
    parentCount: 1,
    ...overrides,
  };
}

describe('localDayBounds', () => {
  it('bounds the day from local midnight inclusive to the next midnight exclusive', () => {
    expect(bounds.start.getTime()).toBe(new Date(2026, 5, 16, 0, 0, 0, 0).getTime());
    expect(bounds.end.getTime()).toBe(new Date(2026, 5, 17, 0, 0, 0, 0).getTime());
  });
});

describe('countMyCommitsForDay', () => {
  const q = { myEmail: MY, dayStartLocal: bounds.start, dayEndLocal: bounds.end };

  it('counts my commits for the day (excluding merges by default)', () => {
    const commits = [commit({ authorDate: dt(9) }), commit({ authorDate: dt(14) })];
    expect(countMyCommitsForDay(commits, q)).toBe(2);
  });

  it('matches the email case-insensitively', () => {
    expect(countMyCommitsForDay([commit({ authorEmail: 'Adrien@Iglou.EU' })], q)).toBe(1);
  });

  it('excludes commits from another author', () => {
    expect(countMyCommitsForDay([commit({ authorEmail: 'autre@example.com' })], q)).toBe(0);
  });

  it('excludes merges by default, includes them when requested', () => {
    const merge = commit({ parentCount: 2 });
    expect(countMyCommitsForDay([merge], q)).toBe(0);
    expect(countMyCommitsForDay([merge], { ...q, includeMerges: true })).toBe(1);
  });

  it('includes midnight (start inclusive) and excludes the next midnight (end exclusive)', () => {
    const atStart = commit({ authorDate: new Date(2026, 5, 16, 0, 0, 0, 0) });
    const atEnd = commit({ authorDate: new Date(2026, 5, 17, 0, 0, 0, 0) });
    expect(countMyCommitsForDay([atStart, atEnd], q)).toBe(1);
  });

  it('excludes a commit from the previous day', () => {
    expect(countMyCommitsForDay([commit({ authorDate: new Date(2026, 5, 15, 23, 59) })], q)).toBe(0);
  });

  it('returns 0 when the reference email is empty', () => {
    expect(countMyCommitsForDay([commit()], { ...q, myEmail: '   ' })).toBe(0);
  });
});
