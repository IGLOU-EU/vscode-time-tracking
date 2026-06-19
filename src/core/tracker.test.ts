import { describe, it, expect } from 'vitest';
import { createTracker, type Tracker, type PauseInfo, type CountdownInfo } from './tracker';
import type { Interval } from './intervals';

const min = (n: number): number => n * 60_000;
const h = (n: number): number => n * 3_600_000;
const DAY = 86_400_000;
const utcMidnightOf = (t: number): number => Math.floor(t / DAY) * DAY;
const T0 = 5 * DAY + h(9); // day 5, 09:00 UTC

function setup(overrides: Partial<Parameters<typeof createTracker>[0]> = {}): {
  tracker: Tracker;
  emitted: Interval[];
} {
  const emitted: Interval[] = [];
  const tracker = createTracker({
    idleThresholdMs: min(30),
    backgroundTimeoutMs: min(30),
    focusCapMs: min(60),
    debugIdleCapMs: 0,
    minSessionMs: min(2),
    midnightOf: utcMidnightOf,
    ...overrides,
  });
  tracker.onIntervalClosed((iv) => emitted.push(iv));
  return { tracker, emitted };
}

describe('presence and confirmation', () => {
  it('presence alone stays pending and bills nothing', () => {
    const { tracker, emitted } = setup();
    tracker.setPresence(true, T0);
    tracker.tick(T0);
    expect(tracker.getPhase(T0)).toBe('pending');
    tracker.tick(T0 + min(5)); // no auto-confirm by time: presence alone never counts
    expect(tracker.getPhase(T0 + min(5))).toBe('pending');
    tracker.setPresence(false, T0 + min(6));
    expect(tracker.getPhase(T0 + min(6))).toBe('idle');
    expect(emitted).toEqual([]);
  });

  it('a targeted activity confirms immediately, counting from the activity', () => {
    const { tracker, emitted } = setup();
    tracker.setPresence(true, T0);
    tracker.recordActivity(T0 + min(0.5));
    expect(tracker.getPhase(T0 + min(0.5))).toBe('active');
    tracker.flush(T0 + min(5));
    expect(emitted).toEqual([{ start: T0 + min(0.5), end: T0 + min(5) }]);
  });

  it('flushing a focused window returns to pending, not idle (presence outlives the flush)', () => {
    // Reproduces activation: the focus snapshot moves idle -> pending, then the initial project
    // switch flushes. The window is still focused, so it must stay awaiting confirmation.
    const { tracker } = setup();
    tracker.setPresence(true, T0);
    expect(tracker.getPhase(T0)).toBe('pending');
    tracker.flush(T0);
    expect(tracker.getPhase(T0)).toBe('pending');
  });

  it('flushing an unfocused window returns to idle', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.flush(T0 + min(2));
    expect(emitted).toEqual([{ start: T0, end: T0 + min(2) }]);
    expect(tracker.getPhase(T0 + min(2))).toBe('idle');
  });
});

describe('focused thinking', () => {
  it('does not pause on inactivity while focused, up to the focus cap', () => {
    const { tracker } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.tick(T0 + min(45)); // 45 min focused with no input, still under the 60 min cap
    expect(tracker.getPhase(T0 + min(45))).toBe('active');
  });

  it('on the focus cap, deducts the forgotten tail and bills only up to the last real action', () => {
    const { tracker, emitted } = setup();
    const pauses: PauseInfo[] = [];
    tracker.onPaused((p) => pauses.push(p));
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.recordActivity(T0 + min(20)); // last real action at 20 min
    tracker.tick(T0 + min(20));
    tracker.tick(T0 + min(50)); // focused-idle, still under cap
    tracker.tick(T0 + min(81)); // 61 min since last action > 60 min cap -> pause and deduct
    expect(emitted).toEqual([{ start: T0, end: T0 + min(20) }]); // forgotten 60 min not billed
    expect(pauses[0]).toMatchObject({ reason: 'focus-cap', capped: true, thresholdMs: min(60), deductedMs: min(30) });
  });
});

describe('losing and regaining focus', () => {
  it('holds the out-grace as paused once the inactivity threshold passes', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1)); // leave the editor -> the grace starts fresh here
    tracker.tick(T0 + min(31)); // 30 min since leaving -> still eligible
    tracker.tick(T0 + min(32)); // 31 min > 30 -> hold the grace, no pause and nothing emitted yet
    expect(tracker.getPhase(T0 + min(32))).toBe('grace');
    expect(emitted).toEqual([]);
    expect(tracker.getCountdown(T0 + min(32))).toMatchObject({ reason: 'focus-cap' }); // idle countdown
  });

  it('an action during the grace keeps it and starts a fresh session', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(32)); // -> grace, graceEnd = T0 + 31
    tracker.recordActivity(T0 + min(40)); // back to work
    expect(tracker.getPhase(T0 + min(40))).toBe('active'); // fresh session before the flush closes it
    tracker.flush(T0 + min(45));
    // grace [T0..T0+31] kept, the paused gap 31..40 not counted, fresh session 40..45.
    expect(emitted).toEqual([
      { start: T0, end: T0 + min(31) },
      { start: T0 + min(40), end: T0 + min(45) },
    ]);
  });

  it('a focus return during the grace keeps it and pauses until an action', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(32)); // -> grace
    tracker.setPresence(true, T0 + min(40)); // glance back, no real action
    expect(emitted).toEqual([{ start: T0, end: T0 + min(31) }]); // grace kept
    expect(tracker.getPhase(T0 + min(40))).toBe('paused');
    tracker.recordActivity(T0 + min(42)); // a real action resumes
    expect(tracker.getPhase(T0 + min(42))).toBe('active');
    tracker.flush(T0 + min(45));
    expect(emitted).toEqual([
      { start: T0, end: T0 + min(31) },
      { start: T0 + min(42), end: T0 + min(45) },
    ]);
  });

  it('no return drops the grace at the focus cap (deducted)', () => {
    const { tracker, emitted } = setup();
    const pauses: PauseInfo[] = [];
    tracker.onPaused((p) => pauses.push(p));
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(32)); // -> grace, silence measured from T0 + 1
    tracker.tick(T0 + min(60)); // 59 min since leaving, still under the 60 cap
    expect(tracker.getPhase(T0 + min(60))).toBe('grace');
    tracker.tick(T0 + min(62)); // 61 min > 60 -> drop the grace
    expect(emitted).toEqual([{ start: T0, end: T0 + min(1) }]); // only up to the focus leave
    expect(pauses[0]).toMatchObject({ reason: 'focus-cap', capped: true, deductedMs: min(30) });
    expect(tracker.getPhase(T0 + min(62))).toBe('idle');
  });

  it('with the cap disabled, the grace is counted at the threshold (old behaviour)', () => {
    const { tracker, emitted } = setup({ focusCapMs: 0 });
    const pauses: PauseInfo[] = [];
    tracker.onPaused((p) => pauses.push(p));
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(31)); // still eligible
    tracker.tick(T0 + min(32)); // 31 min > 30 -> pause, grace counted
    expect(emitted).toEqual([{ start: T0, end: T0 + min(31) }]);
    expect(pauses[0]).toMatchObject({ reason: 'inactivity', capped: false, deductedMs: 0 });
  });

  it('a hand pause during the grace keeps it and parks until an action', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(32)); // -> grace, graceEnd = T0 + 31
    tracker.pause(T0 + min(35)); // hand pause while held in the grace
    expect(emitted).toEqual([{ start: T0, end: T0 + min(31) }]); // grace kept
    expect(tracker.getPhase(T0 + min(35))).toBe('paused');
    tracker.recordActivity(T0 + min(40)); // a real action resumes with a fresh session
    expect(tracker.getPhase(T0 + min(40))).toBe('active');
    tracker.flush(T0 + min(45));
    expect(emitted).toEqual([
      { start: T0, end: T0 + min(31) },
      { start: T0 + min(40), end: T0 + min(45) },
    ]);
  });

  it('flushing during the grace keeps it (deactivate / project switch counts the held grace)', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(32)); // -> grace, graceEnd = T0 + 31
    tracker.flush(T0 + min(35));
    expect(emitted).toEqual([{ start: T0, end: T0 + min(31) }]); // grace kept on flush
    expect(tracker.getPhase(T0 + min(35))).toBe('idle'); // unfocused -> idle
  });

  it('exposes the held grace via getOpenInterval (crash recovery keeps it, end frozen at graceEnd)', () => {
    const { tracker } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1));
    tracker.tick(T0 + min(32)); // -> grace, graceEnd = T0 + 31
    expect(tracker.getOpenInterval(T0 + min(50))).toEqual({ start: T0, end: T0 + min(31) });
  });

  it('a focus return keeps an active session alive without any other action', () => {
    const { tracker } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1)); // go work on the DB
    tracker.tick(T0 + min(20)); // unfocused grace, still active
    tracker.setPresence(true, T0 + min(25)); // glance at VSCode for info, no scroll/click
    tracker.setPresence(false, T0 + min(26)); // back to the DB
    tracker.tick(T0 + min(50)); // 25 min since the glance (< 30) -> still active thanks to the focus-in
    expect(tracker.getPhase(T0 + min(50))).toBe('active');
  });
});

describe('processes', () => {
  it('a running process keeps the session alive past the inactivity threshold (background grace)', () => {
    const { tracker } = setup({ backgroundTimeoutMs: min(45) });
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0);
    tracker.setTerminalRunning(true);
    tracker.tick(T0 + min(40)); // 40 > idle 30, but process grace is 45 -> still active
    expect(tracker.getPhase(T0 + min(40))).toBe('active');
  });

  it('a debug session holds tracking open indefinitely when no cap is set', () => {
    const { tracker } = setup();
    tracker.setDebugActive(true);
    tracker.tick(T0);
    tracker.tick(T0 + h(2));
    expect(tracker.getPhase(T0 + h(2))).toBe('active');
  });
});

describe('manual pause, resume, ignore', () => {
  it('pause bills the session and reports paused; a later activity resumes automatically', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.recordActivity(T0 + min(5));
    tracker.tick(T0 + min(5));
    tracker.pause(T0 + min(5));
    expect(tracker.getPhase(T0 + min(5))).toBe('paused');
    tracker.recordActivity(T0 + min(7)); // a targeted action resumes (toggle off)
    expect(tracker.getPhase(T0 + min(7))).toBe('active');
    tracker.flush(T0 + min(9));
    expect(emitted).toEqual([
      { start: T0, end: T0 + min(5) },
      { start: T0 + min(7), end: T0 + min(9) },
    ]);
  });

  it('resume clears a manual pause, then waits for the next action', () => {
    const { tracker } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.pause(T0 + min(3)); // past the noise threshold, so it really pauses
    expect(tracker.getPhase(T0 + min(3))).toBe('paused');
    tracker.resume();
    expect(tracker.getPhase(T0 + min(3))).toBe('idle');
  });

  it('a short session stopped by hand is discarded and returns to awaiting, not paused', () => {
    const { tracker, emitted } = setup({ minSessionMs: min(2) });
    const discarded: Array<{ ms: number; thresholdMs: number }> = [];
    tracker.onSessionDiscarded((info) => discarded.push({ ms: info.ms, thresholdMs: info.thresholdMs }));
    tracker.setPresence(true, T0);
    tracker.recordActivity(T0 + min(0.2));
    expect(tracker.getPhase(T0 + min(0.5))).toBe('active');
    tracker.pause(T0 + min(1)); // under 2 min after the start: noise, not work
    expect(emitted).toEqual([]);
    expect(tracker.getPhase(T0 + min(1))).toBe('pending'); // focused -> awaiting confirmation
    expect(discarded).toEqual([{ ms: min(0.8), thresholdMs: min(2) }]); // reported for the debug log
  });

  it('a short session stopped while unfocused is discarded back to idle', () => {
    const { tracker, emitted } = setup({ minSessionMs: min(2) });
    tracker.recordActivity(T0);
    tracker.setPresence(false, T0 + min(0.5));
    tracker.pause(T0 + min(1));
    expect(emitted).toEqual([]);
    expect(tracker.getPhase(T0 + min(1))).toBe('idle');
  });

  it('minSessionMs = 0 keeps even a one-second hand pause', () => {
    const { tracker, emitted } = setup({ minSessionMs: 0 });
    tracker.recordActivity(T0);
    tracker.pause(T0 + 1000);
    expect(emitted).toEqual([{ start: T0, end: T0 + 1000 }]);
    expect(tracker.getPhase(T0 + 1000)).toBe('paused');
  });

  it('ignoreCurrentSession drops the open session without emitting', () => {
    const { tracker, emitted } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.recordActivity(T0 + min(5));
    tracker.tick(T0 + min(5));
    tracker.ignoreCurrentSession();
    expect(emitted).toEqual([]);
    expect(tracker.currentOpenMs(T0 + min(5))).toBe(0);
  });
});

describe('midnight split', () => {
  it('emits the completed day and keeps the session open in the new day', () => {
    const { tracker, emitted } = setup();
    const start = 6 * DAY - h(1); // 23:00
    tracker.recordActivity(start);
    tracker.tick(start);
    tracker.recordActivity(6 * DAY + h(1)); // 01:00 next day
    tracker.tick(6 * DAY + h(1));
    expect(emitted).toEqual([{ start, end: 6 * DAY }]);
    expect(tracker.currentOpenMs(6 * DAY + h(1))).toBe(h(1));
  });
});

describe('countdown start', () => {
  it('announces once after activity stops, toward the binding limit', () => {
    const { tracker } = setup();
    const counts: CountdownInfo[] = [];
    tracker.onCountdownStarted((c) => counts.push(c));
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.tick(T0 + min(1.5)); // 90 s of silence (>= 60 s) -> countdown toward the focus cap
    tracker.tick(T0 + min(1.6)); // already announced
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ reason: 'focus-cap', thresholdMs: min(60) });
  });

  it('exposes the live remaining time via getCountdown (null while working)', () => {
    const { tracker } = setup();
    tracker.recordActivity(T0);
    tracker.tick(T0);
    expect(tracker.getCountdown(T0 + min(0.5))).toBeNull(); // worked < 1 min ago
    expect(tracker.getCountdown(T0 + min(1.5))).toEqual({ reason: 'focus-cap', remainingMs: min(60) - min(1.5) });
  });
});
