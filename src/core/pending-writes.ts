// Pure core: follows the writes started from synchronous callbacks, which nobody awaits. Shutdown
// waits for them before it clears the crash-recovery marker, and a failed one is reported instead
// of being left as an unhandled rejection. NO 'vscode' import.

export interface PendingWrites {
  /** Follow a write until it settles. A rejection goes to the error callback. */
  track(write: Promise<unknown>): void;
  /** Resolves once every write tracked so far has settled, failed ones included. Never rejects. */
  settled(): Promise<void>;
}

export function createPendingWrites(onError: (error: unknown) => void): PendingWrites {
  // Only the writes still running: a settled one leaves the set, so it stays bounded.
  const inFlight = new Set<Promise<void>>();
  return {
    track(write) {
      const tracked = write.then(() => undefined, onError).finally(() => inFlight.delete(tracked));
      inFlight.add(tracked);
    },
    async settled() {
      await Promise.allSettled(inFlight);
    },
  };
}
