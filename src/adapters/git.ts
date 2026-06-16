// Adapter: counts the user's commits per local day through the built-in git extension API.
// Degrades gracefully (returns {}) when git is disabled, absent, or has no email configured.
import * as vscode from 'vscode';
import type { API as GitAPI, GitExtension, Commit, Repository } from './git-types';
import { dayKeyLocal } from '../core/aggregate';
import { countMyCommitsForDay, localDayBounds, type CommitRecord } from '../core/commits';

export async function getGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return undefined;
  const gitExt = ext.isActive ? ext.exports : await ext.activate();
  if (!gitExt.enabled) return undefined; // user set git.enabled = false
  const api = gitExt.getAPI(1);
  if (api.state === 'initialized') return api;
  await new Promise<void>((resolve) => {
    const sub = api.onDidChangeState((state) => {
      if (state !== 'initialized') return;
      sub.dispose();
      resolve();
    });
  });
  return api;
}

async function resolveEmail(repo: Repository, override: string): Promise<string> {
  if (override.length > 0) return override;
  try {
    return (await repo.getConfig('user.email')) ?? '';
  } catch {
    return '';
  }
}

function toRecords(commits: readonly Commit[]): CommitRecord[] {
  const records: CommitRecord[] = [];
  for (const c of commits) {
    if (!c.authorDate || !c.authorEmail) continue;
    records.push({ hash: c.hash, authorEmail: c.authorEmail, authorDate: c.authorDate, parentCount: c.parents.length });
  }
  return records;
}

/** Per-day commit counts (mine, non-merge) for a folder. Returns {} when git is unavailable. */
export async function myCommitCountsByDay(
  api: GitAPI,
  folder: vscode.Uri,
  emailOverride: string,
  maxEntries = 500,
): Promise<Record<string, number>> {
  const repo = api.getRepository(folder);
  if (!repo) return {};
  const email = (await resolveEmail(repo, emailOverride)).trim().toLowerCase();
  if (email.length === 0) return {};

  let commits: Commit[];
  try {
    commits = await repo.log({ maxEntries });
  } catch {
    return {};
  }

  const counts: Record<string, number> = {};
  for (const r of toRecords(commits)) {
    if (r.parentCount > 1) continue; // skip merges
    if (r.authorEmail.trim().toLowerCase() !== email) continue;
    const key = dayKeyLocal(r.authorDate.getTime());
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Today's commit count (mine), using the shared pure counter. */
export async function myCommitsToday(
  api: GitAPI,
  folder: vscode.Uri,
  emailOverride: string,
  now: Date,
): Promise<number> {
  const repo = api.getRepository(folder);
  if (!repo) return 0;
  const email = await resolveEmail(repo, emailOverride);
  if (email.trim().length === 0) return 0;
  let commits: Commit[];
  try {
    commits = await repo.log({ maxEntries: 500 });
  } catch {
    return 0;
  }
  const { start, end } = localDayBounds(now.getFullYear(), now.getMonth(), now.getDate());
  return countMyCommitsForDay(toRecords(commits), { myEmail: email, dayStartLocal: start, dayEndLocal: end });
}
