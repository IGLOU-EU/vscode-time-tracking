import { describe, it, expect } from 'vitest';
import { CommitCounts } from './git';
import type { API as GitAPI, Commit, Repository } from './git-types';
import type { Uri } from 'vscode';

const MY = 'me@example.com';
const folder = {} as unknown as Uri; // the fake api ignores it

const commit = (date: Date, email = MY, parents: string[] = ['p']): Commit => ({
  hash: `h${date.getTime()}`,
  message: 'm',
  parents,
  authorDate: date,
  authorEmail: email,
});

// A fake repository that counts log() calls and can fire its state-change event on demand.
function makeRepo(commits: Commit[]) {
  let onChange: (() => void) | undefined;
  let logCalls = 0;
  const repo = {
    rootUri: { toString: () => 'repo://r' },
    state: {
      onDidChange: (handler: () => void) => {
        onChange = handler;
        return { dispose() {} };
      },
    },
    log: async () => {
      logCalls += 1;
      return commits;
    },
    getConfig: async () => MY,
  } as unknown as Repository;
  return { repo, fire: () => onChange?.(), logCalls: () => logCalls };
}

const apiFor = (repo: Repository | null): GitAPI => ({ getRepository: () => repo }) as unknown as GitAPI;

describe('CommitCounts', () => {
  it('delegates the per-day counting to the core', async () => {
    const { repo } = makeRepo([commit(new Date(2026, 5, 16, 10)), commit(new Date(2026, 5, 16, 14))]);
    const cc = new CommitCounts(apiFor(repo));
    expect(await cc.byDay(folder, MY, 0)).toEqual({ '20260616': 2 });
  });

  it('serves the cache on a second call without re-running git log', async () => {
    const { repo, logCalls } = makeRepo([commit(new Date(2026, 5, 16, 10))]);
    const cc = new CommitCounts(apiFor(repo));
    await cc.byDay(folder, MY, 0);
    await cc.byDay(folder, MY, 0);
    expect(logCalls()).toBe(1);
  });

  it('recomputes after the repository state changes (new commit, amend, rebase)', async () => {
    const { repo, fire, logCalls } = makeRepo([commit(new Date(2026, 5, 16, 10))]);
    const cc = new CommitCounts(apiFor(repo));
    await cc.byDay(folder, MY, 0);
    fire(); // a git operation happened
    await cc.byDay(folder, MY, 0);
    expect(logCalls()).toBe(2);
  });

  it('recomputes after clear() (e.g. the configured email changed)', async () => {
    const { repo, logCalls } = makeRepo([commit(new Date(2026, 5, 16, 10))]);
    const cc = new CommitCounts(apiFor(repo));
    await cc.byDay(folder, MY, 0);
    cc.clear();
    await cc.byDay(folder, MY, 0);
    expect(logCalls()).toBe(2);
  });

  it('returns an empty map when there is no repository for the folder', async () => {
    const cc = new CommitCounts(apiFor(null));
    expect(await cc.byDay(folder, MY, 0)).toEqual({});
  });
});
