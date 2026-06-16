// Pure core: counting the day's commits. NO 'vscode' import.
// The git API does not filter by date, so the local-day scoping happens here, on testable
// fixtures. The email match is exact (case-insensitive), not the loose regex of LogOptions.author.

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

/** Local bounds of a day: [midnight, the following midnight). month0 is the zero-based month index. */
export function localDayBounds(year: number, month0: number, day: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month0, day, 0, 0, 0, 0),
    end: new Date(year, month0, day + 1, 0, 0, 0, 0),
  };
}
