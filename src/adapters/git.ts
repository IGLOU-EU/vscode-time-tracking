// Adapter: counts the user's commits per local day through the built-in git extension API.
// Degrades gracefully (returns {}) when git is disabled, absent, or has no email configured, and
// leaves git alone until the workspace is trusted.
import * as vscode from 'vscode';
import type { API as GitAPI, GitExtension, Commit, Repository } from './git-types';
import { countMyCommitsByDay, countMyCommitsForDay, localDayBounds, type CommitRecord } from '../core/commits';

async function getGitApi(): Promise<GitAPI | undefined> {
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

/**
 * Hands the git API to onReady once, as soon as it can be had. An untrusted workspace never gets it,
 * as the manifest promises (capabilities.untrustedWorkspaces): git runs commands that the config of
 * a hostile repository can set, such as core.fsmonitor. The built-in git extension does not run
 * there either. Trusting the workspace enables it without a reload, but after the grant event,
 * hence the second listener (seen on 1.82, 1.143 and VSCodium 1.121). Both events and isTrusted
 * exist in 1.82. https://code.visualstudio.com/api/extension-guides/workspace-trust
 */
export function whenGitApiReady(onReady: (api: GitAPI) => void): vscode.Disposable {
  let ready = false;
  let asking = false;
  const tryNow = (): void => {
    if (ready || asking || !vscode.workspace.isTrusted) return;
    asking = true;
    getGitApi().then(
      (api) => {
        asking = false;
        if (!api || ready) return;
        ready = true;
        stop();
        onReady(api);
      },
      () => {
        asking = false; // an extension that fails to activate is tried again on the next change
      },
    );
  };
  const listeners = [vscode.workspace.onDidGrantWorkspaceTrust(tryNow), vscode.extensions.onDidChange(tryNow)];
  const stop = (): void => listeners.forEach((listener) => listener.dispose());
  tryNow();
  return { dispose: stop };
}

// The API's getConfig reads the repository-local scope only, while most setups define user.email
// globally, so the global scope is the fallback. Each read failure falls through: the git
// extension resolves reads to '' or rejects while it is still settling at startup.
async function resolveEmail(repo: Repository, override: string): Promise<string> {
  if (override.length > 0) return override;
  try {
    const local = await repo.getConfig('user.email');
    if (local) return local;
  } catch {
    // fall through to the global scope
  }
  try {
    return (await repo.getGlobalConfig('user.email')) ?? '';
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

/**
 * Per-day commit counts (mine, non-merge) for a folder, restricted to commits authored on or after
 * `sinceMs` (the history window: older commits are never displayed, so they are not counted).
 * Returns null when the count could not be established (no repository, no resolvable email, or a
 * failed git log), so the caller can tell a transient failure from an authoritative zero.
 */
export async function myCommitCountsByDay(
  api: GitAPI,
  folder: vscode.Uri,
  emailOverride: string,
  sinceMs = 0,
  maxEntries = 500,
): Promise<Record<string, number> | null> {
  const repo = api.getRepository(folder);
  if (!repo) return null;
  const email = (await resolveEmail(repo, emailOverride)).trim().toLowerCase();
  if (email.length === 0) return null;

  let commits: Commit[];
  try {
    commits = await repo.log({ maxEntries });
  } catch {
    return null;
  }
  return countMyCommitsByDay(toRecords(commits), { myEmail: email, sinceMs });
}

/**
 * Caches the per-day commit counts per repository so the panel does not re-run `git log` on every
 * refresh (the panel rebuilds ~once a minute while open). The cache is dropped when the repository
 * state changes (a new commit, amend, rebase, or checkout), the git-side analogue of the file
 * watcher evicting a changed JSONL file. clear() handles a settings change (e.g. the configured
 * email) that the git state event would not signal. A failed count (null) is never cached: a
 * transient startup failure would otherwise freeze "zero commits" until the next git operation.
 */
export class CommitCounts implements vscode.Disposable {
  private readonly cache = new Map<string, Record<string, number>>();
  private readonly subs = new Map<string, vscode.Disposable>();

  constructor(private readonly api: GitAPI) {}

  async byDay(folder: vscode.Uri, emailOverride: string, sinceMs: number): Promise<Record<string, number>> {
    const repo = this.api.getRepository(folder);
    if (!repo) return {};
    const key = repo.rootUri.toString();
    if (!this.subs.has(key)) {
      this.subs.set(key, repo.state.onDidChange(() => this.cache.delete(key)));
    }
    const hit = this.cache.get(key);
    if (hit) return hit;
    const counts = await myCommitCountsByDay(this.api, folder, emailOverride, sinceMs);
    if (counts === null) return {}; // transient failure: retry on the next refresh instead of caching
    this.cache.set(key, counts);
    return counts;
  }

  clear(): void {
    this.cache.clear();
  }

  dispose(): void {
    for (const sub of this.subs.values()) sub.dispose();
    this.subs.clear();
    this.cache.clear();
  }
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
