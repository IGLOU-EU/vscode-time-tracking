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
// `localEmail`/`globalEmail` model the two git config scopes (an Error value makes the read throw),
// and both can change over time to model the git extension settling after startup.
function makeRepo(
  commits: Commit[],
  opts: { localEmail?: string | Error; globalEmail?: string; logFailures?: number } = {},
) {
  let onChange: (() => void) | undefined;
  let logCalls = 0;
  let localEmail = opts.localEmail ?? MY;
  let logFailures = opts.logFailures ?? 0;
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
      if (logFailures > 0) {
        logFailures -= 1;
        throw new Error('git busy');
      }
      return commits;
    },
    getConfig: async () => {
      if (localEmail instanceof Error) throw localEmail;
      return localEmail;
    },
    getGlobalConfig: async () => opts.globalEmail ?? '',
  } as unknown as Repository;
  return {
    repo,
    fire: () => onChange?.(),
    logCalls: () => logCalls,
    setLocalEmail: (e: string) => {
      localEmail = e;
    },
  };
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

  // Email resolution and its failure modes. Most setups only define user.email globally (the git
  // API's getConfig reads the local scope alone), and a transient startup failure must never be
  // remembered as "zero commits" until the next git operation.
  it('falls back to the global git email when the repository has no local one', async () => {
    const { repo } = makeRepo([commit(new Date(2026, 5, 16, 10))], { localEmail: '', globalEmail: MY });
    const cc = new CommitCounts(apiFor(repo));
    expect(await cc.byDay(folder, '', 0)).toEqual({ '20260616': 1 });
  });

  it('falls back to the global git email when reading the local one throws', async () => {
    const { repo } = makeRepo([commit(new Date(2026, 5, 16, 10))], {
      localEmail: new Error('config failed'),
      globalEmail: MY,
    });
    const cc = new CommitCounts(apiFor(repo));
    expect(await cc.byDay(folder, '', 0)).toEqual({ '20260616': 1 });
  });

  it('does not cache a count whose email resolution failed (transient startup state)', async () => {
    const fake = makeRepo([commit(new Date(2026, 5, 16, 10))], { localEmail: '', globalEmail: '' });
    const cc = new CommitCounts(apiFor(fake.repo));
    expect(await cc.byDay(folder, '', 0)).toEqual({});
    fake.setLocalEmail(MY); // the git extension settled after startup
    // No state change and no clear(): only the absence of caching lets the retry succeed.
    expect(await cc.byDay(folder, '', 0)).toEqual({ '20260616': 1 });
  });

  it('does not cache a failed git log, and retries on the next refresh', async () => {
    const fake = makeRepo([commit(new Date(2026, 5, 16, 10))], { logFailures: 1 });
    const cc = new CommitCounts(apiFor(fake.repo));
    expect(await cc.byDay(folder, MY, 0)).toEqual({});
    expect(await cc.byDay(folder, MY, 0)).toEqual({ '20260616': 1 });
  });

  it('still caches a genuine zero-commit result', async () => {
    const fake = makeRepo([commit(new Date(2026, 5, 16, 10), 'someone@else.dev')]);
    const cc = new CommitCounts(apiFor(fake.repo));
    expect(await cc.byDay(folder, MY, 0)).toEqual({});
    expect(await cc.byDay(folder, MY, 0)).toEqual({});
    expect(fake.logCalls()).toBe(1); // an authoritative empty count is cacheable
  });
});
