// Pure core: the tracking orchestrator. NO 'vscode' import.
//
// Phases:
//   idle    -> nothing tracked.
//   pending -> the window is focused but no targeted activity has happened yet. Shown as
//              "awaiting confirmation". Presence alone is NEVER counted: it stays pending, with
//              zero time counted, until a real action confirms it (or focus is lost).
//   active  -> tracking, entered by a targeted activity (keystroke, click, selection, scroll,
//              file write) or by a debug/terminal process.
//
// While the window is FOCUSED, the session never pauses on inactivity (thinking and reading
// count), bounded only by a long focus safety cap. When focus is LOST, the inactivity grace runs
// (browser/db/docs is still work), but it is held PROVISIONALLY in a 'grace' phase (shown as
// paused, counting down to the focus cap): coming back keeps it as work, reaching the cap with no
// return drops it as a forgotten session. With the focus cap disabled the grace is simply counted
// at the threshold (the old, non-provisional behaviour). A running process uses the background
// grace instead.
//
// Silence limits are of two kinds:
//   timeouts (counted):  inactivity (unfocused, counted only if you return), background-timeout.
//                        The grace counts as work.
//   safety caps (deducted): focus-cap, debug-cap. These guard against a forgotten session, so the
//                           cap duration is removed from the recorded time (closed at the last
//                           real action) to avoid counting an oversight.

import { splitAtMidnight, localMidnightOf, type Interval } from './intervals';

// 'grace' is the unfocused out-grace held provisionally after the inactivity threshold: shown as
// paused, it counts down toward the focus cap. Coming back keeps the grace, the cap drops it.
export type TrackPhase = 'idle' | 'pending' | 'active' | 'grace' | 'paused';
export type PauseReason = 'inactivity' | 'background-timeout' | 'focus-cap' | 'debug-cap';

export interface PauseInfo {
  readonly reason: PauseReason;
  readonly capped: boolean; // a safety cap (focus/debug): its duration is deducted
  readonly silentMs: number; // silence since the last action (or session start)
  readonly thresholdMs: number; // the limit that was crossed
  readonly deductedMs: number; // time removed from the recorded session (0 for counted timeouts)
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
  idleThresholdMs: number; // unfocused inactivity grace (counted)
  backgroundTimeoutMs: number; // running process without interaction (counted)
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

/**
 * How long a window must keep the focus before the gain means anything. Alt-tabbing through
 * windows, or clicking the taskbar icon to reach another one, focuses each window it crosses:
 * that is not a return to work and must not rearm the idle timer. The adapter holds scrolls back
 * over the same delay, since a window that just took focus is still relaying out.
 */
export const FOCUS_SETTLE_MS = 5_000;

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
  let pendingFocusAt: number | null = null; // a focus gain waiting to prove it is not a pass-through
  let graceEnd = 0; // end of the provisionally-held out-grace, valid only while phase === 'grace'
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

  // Ending a session: a session too short to be work is a false start (a stray click, a window
  // opened and closed, an action right before switching project) and is dropped whatever ended it,
  // not just a hand pause. The floor judges the whole session, so a day boundary cutting a long
  // one into a short leg is unaffected: that leg was already emitted by the split.
  // Returns whether the time was kept.
  const closeSession = (endAt: number, at: number): boolean => {
    const ms = Math.max(0, endAt - openStart); // what would actually be recorded
    if (ms < minSessionMs) {
      for (const cb of discardListeners) cb({ ms, thresholdMs: minSessionMs, at });
      return false;
    }
    closeOpen(endAt);
    return true;
  };

  // A focus gain, once it has proven to be a real return. Entering the editor is a deliberate work
  // transition: for an already-active session it resets the idle timer, so the new grace starts
  // fresh (glancing at the editor for info keeps it alive, and thinking under focus does not eat
  // into the inactivity grace once you leave for the DB/browser). From rest it only moves
  // idle -> pending: a stray focus never starts counting, a real action confirms.
  const applyFocusGain = (at: number): void => {
    const wasFocused = windowFocused;
    windowFocused = true;
    countdownAnnounced = false; // the binding limit may have changed
    if (manualPaused) return;
    if (phase === 'grace') {
      // A focus return disarms the idle timer and keeps the grace, leaving the session paused
      // until a real action resumes it.
      closeSession(graceEnd, at);
      manualPaused = true;
      phase = 'idle';
      return;
    }
    if (phase === 'active') {
      if (!wasFocused && at > lastActivityAt) lastActivityAt = at;
    } else if (phase === 'idle') {
      phase = 'pending';
    }
  };

  const settleFocus = (now: number): void => {
    if (pendingFocusAt === null || now - pendingFocusAt < FOCUS_SETTLE_MS) return;
    const at = pendingFocusAt;
    pendingFocusAt = null;
    applyFocusGain(at);
  };

  const startActive = (start: number, now: number): void => {
    openStart = start;
    lastActiveAt = now;
    phase = 'active';
    countdownAnnounced = false;
  };

  return {
    recordActivity(at) {
      if (phase === 'grace') {
        closeSession(graceEnd, at); // keep the provisional out-grace, the paused gap is not counted
        if (at > lastActivityAt) lastActivityAt = at;
        manualPaused = false;
        startActive(at, at); // fresh session from the action
        return;
      }
      if (at > lastActivityAt) lastActivityAt = at;
      countdownAnnounced = false; // new activity re-arms the countdown
      manualPaused = false; // a targeted action resumes from a manual pause
      if (phase === 'active') return;
      startActive(at, at); // a targeted action confirms the session (presence alone does not)
    },
    setPresence(focused, at) {
      if (focused) {
        // Hold the gain until it proves itself (see FOCUS_SETTLE_MS). Only the awaiting display
        // moves right away, because it counts nothing and must not lag behind the window.
        if (pendingFocusAt === null) pendingFocusAt = at;
        if (!manualPaused && phase === 'idle') phase = 'pending';
        return;
      }
      if (pendingFocusAt !== null) {
        const gainedAt = pendingFocusAt;
        pendingFocusAt = null;
        if (at - gainedAt < FOCUS_SETTLE_MS) {
          // A pass-through: undo the display, leave every timer exactly as it was.
          windowFocused = false;
          if (!manualPaused && phase === 'pending') phase = 'idle';
          return;
        }
        applyFocusGain(gainedAt); // it did last, so it counted after all, and is lost right below
      }
      const wasFocused = windowFocused;
      windowFocused = false;
      countdownAnnounced = false; // the binding limit may have changed
      if (manualPaused) return;
      if (phase === 'grace') return; // a stray unfocus just keeps holding
      // Leaving the editor is a deliberate work transition too: it resets the idle timer, so the
      // unfocused grace starts fresh from the moment focus was lost.
      if (phase === 'active') {
        if (wasFocused && at > lastActivityAt) lastActivityAt = at;
      } else if (phase === 'pending') {
        phase = 'idle'; // left without acting: nothing counted
      }
    },
    setDebugActive(active) {
      debugActive = active;
    },
    setTerminalRunning(running) {
      terminalRunning = running;
    },
    pause(at) {
      if (phase === 'grace') {
        closeSession(graceEnd, at); // a hand pause during the grace keeps it, like a focus return
        manualPaused = true;
        phase = 'idle';
        return;
      }
      // A discarded false start goes back to awaiting rather than paused: there is nothing to
      // resume, and a focused window is still a presence.
      if (phase === 'active' && !closeSession(at, at)) {
        phase = windowFocused ? 'pending' : 'idle';
        return;
      }
      manualPaused = true;
      phase = 'idle';
    },
    resume() {
      manualPaused = false;
    },
    ignoreCurrentSession() {
      phase = 'idle';
    },
    tick(now) {
      settleFocus(now); // a held focus gain that outlived the settle delay is a real return
      if (manualPaused) return;

      if (phase === 'active') {
        if (!eligible(now)) {
          // Out-grace elapsed unfocused: hold it provisionally and run the focus cap as the idle
          // timer. Coming back before the cap keeps the grace, the cap drops it (deducted). The
          // config adapter guarantees focusCapMs >= idleThresholdMs when set, so graceEnd never
          // outlasts the cap (a smaller cap would drop the grace before it is even reached).
          if (!windowFocused && !continuous() && Number.isFinite(cap(focusCapMs))) {
            graceEnd = silenceSince() + idleThresholdMs;
            phase = 'grace';
            countdownAnnounced = false;
            return;
          }
          const k = binding();
          // Safety caps close at the last real action (deducting the whole forgotten tail, which is
          // at least the cap); counted timeouts close at the last active tick (the grace counts).
          const closeAt = k.capped ? silenceSince() : lastActiveAt;
          // A discarded false start reports nothing as a pause: no time was kept to explain.
          if (closeSession(closeAt, now) && pauseListeners.length > 0) {
            const silentMs = now - silenceSince();
            const deductedMs = Math.max(0, lastActiveAt - closeAt);
            for (const cb of pauseListeners) {
              cb({ reason: k.reason, capped: k.capped, silentMs, thresholdMs: k.ms, deductedMs, at: now });
            }
          }
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

      if (phase === 'grace') {
        const idleCapMs = cap(focusCapMs);
        if (now - silenceSince() > idleCapMs) {
          // The idle timer expired with no return: drop the provisional grace, keeping only up to
          // the last real action (the focus-cap deduction applied to the unfocused tail).
          // closeSession excludes the dropped grace, and stays silent on a false start.
          if (closeSession(silenceSince(), now) && pauseListeners.length > 0) {
            const deductedMs = Math.max(0, graceEnd - silenceSince());
            const silentMs = now - silenceSince();
            for (const cb of pauseListeners) {
              cb({ reason: 'focus-cap', capped: true, silentMs, thresholdMs: idleCapMs, deductedMs, at: now });
            }
          }
          phase = 'idle';
          return;
        }
        if (!countdownAnnounced) {
          const remainingMs = Math.max(0, idleCapMs - (now - silenceSince()));
          for (const cb of countdownListeners) cb({ reason: 'focus-cap', thresholdMs: idleCapMs, remainingMs, at: now });
          countdownAnnounced = true;
        }
        return;
      }

      // pending or idle: a debug/terminal process starts a session on its own.
      if (continuous()) startActive(now, now);
    },
    flush(now) {
      if (phase === 'active') closeSession(now, now);
      else if (phase === 'grace') closeSession(graceEnd, now); // keep the provisional grace on a flush
      // A flush closes the interval but does not end the user's presence, so a still-focused window
      // returns to pending (awaiting confirmation), not idle. A gain still settling counts as
      // presence here: the window is focused, only its effect on the timers is on hold.
      phase = windowFocused || pendingFocusAt !== null ? 'pending' : 'idle';
    },
    getPhase() {
      return manualPaused ? 'paused' : phase;
    },
    currentOpenMs(now) {
      return phase === 'active' ? Math.max(0, now - openStart) : 0;
    },
    getCountdown(now) {
      if (phase === 'grace') {
        const idleCapMs = cap(focusCapMs);
        return { reason: 'focus-cap', remainingMs: Math.max(0, idleCapMs - (now - silenceSince())) };
      }
      if (phase !== 'active') return null;
      const silent = now - silenceSince();
      if (silent < MIN_COUNTDOWN_SILENCE_MS) return null; // still working, not counting down
      const k = binding();
      if (!Number.isFinite(k.ms)) return null; // a debug session holds it open indefinitely
      return { reason: k.reason, remainingMs: Math.max(0, k.ms - silent) };
    },
    getOpenInterval(now) {
      if (phase === 'active') return { start: openStart, end: Math.max(openStart, now) };
      if (phase === 'grace') return { start: openStart, end: graceEnd }; // crash keeps the grace
      return null;
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
