// Pure core: the tracking orchestrator. NO 'vscode' import.
//
// Phases:
//   idle    -> nothing tracked.
//   pending -> the window is focused but no targeted activity has happened yet. Shown as
//              "awaiting confirmation". Presence alone is NEVER billed: it stays pending, with
//              zero time counted, until a real action confirms it (or focus is lost).
//   active  -> tracking, entered by a targeted activity (keystroke, click, selection, scroll,
//              file write) or by a debug/terminal process.
//
// While the window is FOCUSED, the session never pauses on inactivity (thinking and reading
// count), bounded only by a long focus safety cap. When focus is LOST, the inactivity grace runs
// (browser/db/docs is still work). A running process uses the background grace.
//
// Silence limits are of two kinds:
//   timeouts (billed):   inactivity (unfocused), background-timeout. The grace counts as work.
//   safety caps (deducted): focus-cap, debug-cap. These guard against a forgotten session, so the
//                           cap duration is removed from the recorded time (closed at the last
//                           real action) to avoid billing an oversight.

import { splitAtMidnight, localMidnightOf, type Interval } from './intervals';

export type TrackPhase = 'idle' | 'pending' | 'active' | 'paused';
export type PauseReason = 'inactivity' | 'background-timeout' | 'focus-cap' | 'debug-cap';

export interface PauseInfo {
  readonly reason: PauseReason;
  readonly capped: boolean; // a safety cap (focus/debug): its duration is deducted
  readonly silentMs: number; // silence since the last action (or session start)
  readonly thresholdMs: number; // the limit that was crossed
  readonly deductedMs: number; // time removed from the recorded session (0 for billed timeouts)
  readonly at: number;
}

export interface CountdownInfo {
  readonly reason: PauseReason;
  readonly thresholdMs: number;
  readonly remainingMs: number;
  readonly at: number;
}

export interface DiscardInfo {
  readonly ms: number; // length of the discarded session
  readonly thresholdMs: number; // the min-session threshold it fell under
  readonly at: number;
}

export interface TrackerConfig {
  idleThresholdMs: number; // unfocused inactivity grace (billed)
  backgroundTimeoutMs: number; // running process without interaction (billed)
  focusCapMs: number; // focused-but-no-activity safety cap (deducted). 0 = never pause while focused
  debugIdleCapMs: number; // debug-without-interaction safety cap (deducted). 0 = never
  minSessionMs: number; // a hand-paused session shorter than this is discarded as noise. 0 = keep all
  midnightOf?: (t: number) => number;
}

interface Keeper {
  reason: PauseReason;
  ms: number;
  capped: boolean;
}

const MIN_COUNTDOWN_SILENCE_MS = 60_000; // count as "working" within a minute of activity; only then count down

export interface Tracker {
  recordActivity(at: number): void;
  setPresence(focused: boolean, at: number): void;
  setDebugActive(active: boolean): void;
  setTerminalRunning(running: boolean): void;
  pause(at: number): void;
  resume(): void;
  ignoreCurrentSession(): void;
  tick(now: number): void;
  flush(now: number): void;
  getPhase(now: number): TrackPhase;
  currentOpenMs(now: number): number;
  /** Live countdown toward a pause while the active session is idle, or null (working / no limit). */
  getCountdown(now: number): { reason: PauseReason; remainingMs: number } | null;
  getOpenInterval(now: number): Interval | null;
  onIntervalClosed(cb: (iv: Interval) => void): void;
  onPaused(cb: (info: PauseInfo) => void): void;
  onCountdownStarted(cb: (info: CountdownInfo) => void): void;
  onSessionDiscarded(cb: (info: DiscardInfo) => void): void;
  setConfig(partial: Partial<TrackerConfig>): void;
}

export function createTracker(config: TrackerConfig): Tracker {
  let idleThresholdMs = config.idleThresholdMs;
  let backgroundTimeoutMs = config.backgroundTimeoutMs;
  let focusCapMs = config.focusCapMs;
  let debugIdleCapMs = config.debugIdleCapMs;
  let minSessionMs = config.minSessionMs;
  const midnightOf = config.midnightOf ?? localMidnightOf;

  let phase: TrackPhase = 'idle';
  let windowFocused = true;
  let debugActive = false;
  let terminalRunning = false;
  let manualPaused = false;
  let lastActivityAt = Number.NEGATIVE_INFINITY;
  let openStart = 0;
  let lastActiveAt = 0;
  let countdownAnnounced = false;
  const listeners: Array<(iv: Interval) => void> = [];
  const pauseListeners: Array<(info: PauseInfo) => void> = [];
  const countdownListeners: Array<(info: CountdownInfo) => void> = [];
  const discardListeners: Array<(info: DiscardInfo) => void> = [];

  const cap = (ms: number): number => (ms > 0 ? ms : Number.POSITIVE_INFINITY);

  // The limits currently keeping the session alive. The one that lasts longest binds the pause.
  const keepers = (): Keeper[] => {
    const ks: Keeper[] = [];
    if (windowFocused) ks.push({ reason: 'focus-cap', ms: cap(focusCapMs), capped: true });
    else ks.push({ reason: 'inactivity', ms: idleThresholdMs, capped: false });
    if (terminalRunning) ks.push({ reason: 'background-timeout', ms: backgroundTimeoutMs, capped: false });
    if (debugActive) ks.push({ reason: 'debug-cap', ms: cap(debugIdleCapMs), capped: true });
    return ks;
  };

  const binding = (): Keeper => keepers().reduce((best, k) => (k.ms > best.ms ? k : best));
  const continuous = (): boolean => debugActive || terminalRunning;
  const silenceSince = (): number => Math.max(openStart, lastActivityAt);
  const eligible = (now: number): boolean => now - silenceSince() <= binding().ms;

  const emit = (iv: Interval): void => {
    for (const cb of listeners) cb(iv);
  };

  const closeOpen = (endAt: number): void => {
    for (const seg of splitAtMidnight({ start: openStart, end: Math.max(openStart, endAt) }, midnightOf)) {
      if (seg.end > seg.start) emit(seg);
    }
  };

  const startActive = (start: number, now: number): void => {
    openStart = start;
    lastActiveAt = now;
    phase = 'active';
    countdownAnnounced = false;
  };

  return {
    recordActivity(at) {
      if (at > lastActivityAt) lastActivityAt = at;
      countdownAnnounced = false; // new activity re-arms the countdown
      manualPaused = false; // a targeted action resumes from a manual pause
      if (phase === 'active') return;
      startActive(at, at); // a targeted action confirms the session (presence alone does not)
    },
    setPresence(focused, at) {
      const wasFocused = windowFocused;
      windowFocused = focused;
      countdownAnnounced = false; // the binding limit may have changed
      if (manualPaused) return;
      // A focus change (entering OR leaving the editor) is a deliberate work transition. For an
      // already-active session it resets the idle timer, so the new grace starts fresh: glancing
      // at the editor for info keeps it alive, and time spent thinking under focus does not eat
      // into the inactivity grace once you leave for the DB/browser. From rest, a stray focus is
      // not enough to start billing: it only moves idle -> pending (a real action confirms).
      if (phase === 'active') {
        if (wasFocused !== focused && at > lastActivityAt) lastActivityAt = at;
      } else if (focused && phase === 'idle') {
        phase = 'pending';
      } else if (!focused && phase === 'pending') {
        phase = 'idle'; // left without acting: nothing billed
      }
    },
    setDebugActive(active) {
      debugActive = active;
    },
    setTerminalRunning(running) {
      terminalRunning = running;
    },
    pause(at) {
      // A session this short that the user stops by hand is noise, not work: discard it unbilled
      // and go back to awaiting rather than paused.
      if (phase === 'active' && at - openStart < minSessionMs) {
        for (const cb of discardListeners) cb({ ms: at - openStart, thresholdMs: minSessionMs, at });
        phase = windowFocused ? 'pending' : 'idle';
        return;
      }
      manualPaused = true;
      if (phase === 'active') closeOpen(at);
      phase = 'idle';
    },
    resume() {
      manualPaused = false;
    },
    ignoreCurrentSession() {
      phase = 'idle';
    },
    tick(now) {
      if (manualPaused) return;

      if (phase === 'active') {
        if (!eligible(now)) {
          const k = binding();
          // Safety caps close at the last real action (deducting the whole forgotten tail, which is
          // at least the cap); billed timeouts close at the last active tick (the grace counts).
          const closeAt = k.capped ? silenceSince() : lastActiveAt;
          if (pauseListeners.length > 0) {
            const silentMs = now - silenceSince();
            const deductedMs = Math.max(0, lastActiveAt - closeAt);
            for (const cb of pauseListeners) {
              cb({ reason: k.reason, capped: k.capped, silentMs, thresholdMs: k.ms, deductedMs, at: now });
            }
          }
          closeOpen(closeAt);
          phase = 'idle';
          return;
        }
        lastActiveAt = now;
        const silentMs = now - silenceSince();
        if (!countdownAnnounced && silentMs >= MIN_COUNTDOWN_SILENCE_MS) {
          const k = binding();
          if (Number.isFinite(k.ms)) {
            const remainingMs = Math.max(0, k.ms - silentMs);
            for (const cb of countdownListeners) cb({ reason: k.reason, thresholdMs: k.ms, remainingMs, at: now });
            countdownAnnounced = true;
          }
        }
        const segs = splitAtMidnight({ start: openStart, end: now }, midnightOf);
        if (segs.length > 1) {
          for (let i = 0; i < segs.length - 1; i++) emit(segs[i]);
          openStart = segs[segs.length - 1].start;
        }
        return;
      }

      // pending or idle: a debug/terminal process starts a session on its own.
      if (continuous()) startActive(now, now);
    },
    flush(now) {
      if (phase === 'active') closeOpen(now);
      // A flush closes the interval but does not end the user's presence, so a still-focused window
      // returns to pending (awaiting confirmation), not idle.
      phase = windowFocused ? 'pending' : 'idle';
    },
    getPhase() {
      return manualPaused ? 'paused' : phase;
    },
    currentOpenMs(now) {
      return phase === 'active' ? Math.max(0, now - openStart) : 0;
    },
    getCountdown(now) {
      if (phase !== 'active') return null;
      const silent = now - silenceSince();
      if (silent < MIN_COUNTDOWN_SILENCE_MS) return null; // still working, not counting down
      const k = binding();
      if (!Number.isFinite(k.ms)) return null; // a debug session holds it open indefinitely
      return { reason: k.reason, remainingMs: Math.max(0, k.ms - silent) };
    },
    getOpenInterval(now) {
      return phase === 'active' ? { start: openStart, end: Math.max(openStart, now) } : null;
    },
    onIntervalClosed(cb) {
      listeners.push(cb);
    },
    onPaused(cb) {
      pauseListeners.push(cb);
    },
    onCountdownStarted(cb) {
      countdownListeners.push(cb);
    },
    onSessionDiscarded(cb) {
      discardListeners.push(cb);
    },
    setConfig(partial) {
      if (partial.idleThresholdMs !== undefined) idleThresholdMs = partial.idleThresholdMs;
      if (partial.backgroundTimeoutMs !== undefined) backgroundTimeoutMs = partial.backgroundTimeoutMs;
      if (partial.focusCapMs !== undefined) focusCapMs = partial.focusCapMs;
      if (partial.debugIdleCapMs !== undefined) debugIdleCapMs = partial.debugIdleCapMs;
      if (partial.minSessionMs !== undefined) minSessionMs = partial.minSessionMs;
    },
  };
}
