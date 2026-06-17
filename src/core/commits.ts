// Pure core: counting the day's commits. NO 'vscode' import.
// The git API does not filter by date, so the local-day scoping happens here, on testable
// fixtures. The email match is exact (case-insensitive), not the loose regex of LogOptions.author.

import { dayKeyLocal } from './aggregate';

export interface CommitRecord {
  readonly hash: string;
  readonly authorEmail: string;
  readonly authorDate: Date;
  /** Number of parents: > 1 = merge commit. */
  readonly parentCount: number;
}

export interface DayCommitQuery {
  readonly myEmail: string;
  /** Local midnight, inclusive. */
  readonly dayStartLocal: Date;
  /** The following local midnight, exclusive. */
  readonly dayEndLocal: Date;
  readonly includeMerges?: boolean;
}

/** Counts my commits (exact email, case-insensitive) falling within [dayStart, dayEnd), merges excluded by default. */
export function countMyCommitsForDay(commits: readonly CommitRecord[], query: DayCommitQuery): number {
  const email = query.myEmail.trim().toLowerCase();
  if (email.length === 0) return 0;

  const start = query.dayStartLocal.getTime();
  const end = query.dayEndLocal.getTime();

  return commits.reduce((count, commit) => {
    if (commit.authorEmail.trim().toLowerCase() !== email) return count;
    if (!query.includeMerges && commit.parentCount > 1) return count;
    const t = commit.authorDate.getTime();
    if (t < start || t >= end) return count;
    return count + 1;
  }, 0);
}

/**
 * Counts my non-merge commits (exact email, case-insensitive) per local day, keeping only those
 * authored on or after `sinceMs`. Commits older than the rendered history window are never shown,
 * so they are dropped here rather than fetched-and-ignored. Keyed by YYYYMMDD local day.
 */
export function countMyCommitsByDay(
  commits: readonly CommitRecord[],
  query: { myEmail: string; sinceMs: number },
): Record<string, number> {
  const email = query.myEmail.trim().toLowerCase();
  if (email.length === 0) return {};

  const counts: Record<string, number> = {};
  for (const c of commits) {
    if (c.parentCount > 1) continue; // skip merges
    if (c.authorDate.getTime() < query.sinceMs) continue; // older than the window
    if (c.authorEmail.trim().toLowerCase() !== email) continue;
    const key = dayKeyLocal(c.authorDate.getTime());
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Local bounds of a day: [midnight, the following midnight). month0 is the zero-based month index. */
export function localDayBounds(year: number, month0: number, day: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month0, day, 0, 0, 0, 0),
    end: new Date(year, month0, day + 1, 0, 0, 0, 0),
  };
}
