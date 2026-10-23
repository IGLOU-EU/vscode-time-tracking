import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPendingWrites } from './pending-writes';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets every queued promise callback run, so a premature resolution would be observed.
const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Tracks whether a promise has settled yet, without awaiting it.
function watch(p: Promise<void>): () => boolean {
  let done = false;
  void p.then(() => {
    done = true;
  });
  return () => done;
}

describe('createPendingWrites', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves settled at once when no write is in flight', async () => {
    const writes = createPendingWrites(() => undefined);
    await expect(writes.settled()).resolves.toBeUndefined();
  });

  it('holds settled until the tracked write finishes', async () => {
    const writes = createPendingWrites(() => undefined);
    const write = deferred();
    writes.track(write.promise);

    const isSettled = watch(writes.settled());
    await drain();
    expect(isSettled()).toBe(false);

    write.resolve();
    await drain();
    expect(isSettled()).toBe(true);
  });

  it('waits for every write in flight, not only the last one', async () => {
    // A session split at midnight closes as two intervals, so two appends are in flight at once.
    const writes = createPendingWrites(() => undefined);
    const first = deferred();
    const second = deferred();
    writes.track(first.promise);
    writes.track(second.promise);

    const isSettled = watch(writes.settled());
    second.resolve();
    await drain();
    expect(isSettled()).toBe(false);

    first.resolve();
    await drain();
    expect(isSettled()).toBe(true);
  });

  it('reports a failed write to the error callback instead of leaving it unhandled', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const onError = vi.fn();
      const writes = createPendingWrites(onError);
      const failure = new Error('ENOSPC: no space left on device');
      writes.track(Promise.reject(failure));
      await drain();

      expect(onError).toHaveBeenCalledWith(failure);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('still resolves settled when a write fails', async () => {
    const writes = createPendingWrites(() => undefined);
    const write = deferred();
    writes.track(write.promise);

    const done = writes.settled();
    write.reject(new Error('EACCES'));
    await expect(done).resolves.toBeUndefined();
  });

  it('does not report a write that succeeds', async () => {
    const onError = vi.fn();
    const writes = createPendingWrites(onError);
    writes.track(Promise.resolve());
    await writes.settled();
    expect(onError).not.toHaveBeenCalled();
  });
});
