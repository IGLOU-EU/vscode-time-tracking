import { afterEach, describe, it, expect, vi } from 'vitest';
import { extensions, workspace } from 'vscode';
import { CommitCounts, whenGitApiReady } from './git';
import type { API as GitAPI, Commit, GitExtension, Repository } from './git-types';
import type { Extension, Uri } from 'vscode';

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

// An event the spec fires by hand, in place of the editor.
function manualEvent() {
  const listeners = new Set<() => void>();
  return {
    event: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: () => [...listeners].forEach((listener) => listener()),
  };
}

// Lets every pending promise callback run, as the editor would between two events.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('whenGitApiReady', () => {
  const api = { state: 'initialized' } as unknown as GitAPI;
  const gitExtension = { isActive: true, exports: { enabled: true, getAPI: () => api } } as unknown as Extension<GitExtension>;
  let trusted = true;
  let gitInstalled = true;
  const trustGranted = manualEvent();
  const extensionsChanged = manualEvent();

  const play = (): void => {
    vi.spyOn(workspace, 'isTrusted', 'get').mockImplementation(() => trusted);
    vi.spyOn(workspace, 'onDidGrantWorkspaceTrust').mockImplementation(trustGranted.event);
    vi.spyOn(extensions, 'onDidChange').mockImplementation(extensionsChanged.event);
    vi.spyOn(extensions, 'getExtension').mockImplementation((() => (gitInstalled ? gitExtension : undefined)) as never);
  };

  afterEach(() => {
    vi.restoreAllMocks();
    trusted = true;
    gitInstalled = true;
  });

  it('hands over the git API of a trusted workspace', async () => {
    play();
    const ready = vi.fn();
    whenGitApiReady(ready);
    await settle();
    expect(ready).toHaveBeenCalledWith(api);
  });

  // In Restricted Mode, git must not run: a hostile repository can make it run a command
  // (core.fsmonitor), and the manifest promises that commits are not counted there.
  it('leaves git alone while the workspace is not trusted', async () => {
    trusted = false;
    play();
    const ready = vi.fn();
    whenGitApiReady(ready);
    extensionsChanged.fire();
    await settle();
    expect(extensions.getExtension).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it('hands over the git API once the workspace is trusted', async () => {
    trusted = false;
    play();
    const ready = vi.fn();
    whenGitApiReady(ready);
    await settle();
    expect(ready).not.toHaveBeenCalled();
    trusted = true;
    trustGranted.fire();
    await settle();
    expect(ready).toHaveBeenCalledWith(api);
  });

  // The editor grants trust first, and only then enables the git extension it kept disabled.
  it('waits for the git extension that the trust grant enables', async () => {
    trusted = false;
    gitInstalled = false;
    play();
    const ready = vi.fn();
    whenGitApiReady(ready);
    trusted = true;
    trustGranted.fire();
    await settle();
    expect(ready).not.toHaveBeenCalled();
    gitInstalled = true;
    extensionsChanged.fire();
    await settle();
    expect(ready).toHaveBeenCalledWith(api);
  });

  it('hands over the git API once, however many events follow', async () => {
    play();
    const ready = vi.fn();
    whenGitApiReady(ready);
    await settle();
    trustGranted.fire();
    extensionsChanged.fire();
    await settle();
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
