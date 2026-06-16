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
  it('bills the inactivity grace then pauses (browser/docs is still work)', () => {
    const { tracker, emitted } = setup();
    const pauses: PauseInfo[] = [];
    tracker.onPaused((p) => pauses.push(p));
    tracker.recordActivity(T0);
    tracker.tick(T0);
    tracker.setPresence(false, T0 + min(1)); // leave the editor -> the grace starts fresh here
    tracker.tick(T0 + min(20));
    tracker.tick(T0 + min(31)); // 30 min since leaving -> still eligible
    tracker.tick(T0 + min(32)); // 31 min since leaving > 30 -> pause, grace billed
    expect(emitted).toEqual([{ start: T0, end: T0 + min(31) }]);
    expect(pauses[0]).toMatchObject({ reason: 'inactivity', capped: false, deductedMs: 0 });
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
    tracker.pause(T0 + min(1));
    expect(tracker.getPhase(T0 + min(1))).toBe('paused');
    tracker.resume();
    expect(tracker.getPhase(T0 + min(1))).toBe('idle');
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
