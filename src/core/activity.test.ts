import { describe, it, expect } from 'vitest';
import { elapsedMs, hoursMinutes, formatClock } from './activity';

describe('elapsedMs', () => {
  it('sums the accumulated time and the time since the start of the session', () => {
    expect(elapsedMs(100, 40, 10)).toBe(70);
  });

  it('clamps to the accumulated value if the clock goes backwards (skew)', () => {
    expect(elapsedMs(30, 40, 10)).toBe(10);
  });
});

describe('hoursMinutes', () => {
  it('breaks down into whole hours and minutes', () => {
    expect(hoursMinutes(2 * 3_600_000 + 30 * 60_000)).toEqual({ hours: 2, minutes: 30 });
  });

  it('truncates the seconds (90 s -> 1 min)', () => {
    expect(hoursMinutes(90_000)).toEqual({ hours: 0, minutes: 1 });
  });
});

describe('formatClock', () => {
  it('compact format with hours', () => {
    expect(formatClock(2 * 3_600_000 + 5 * 60_000)).toBe('2h 05m');
  });

  it('compact format under one hour', () => {
    expect(formatClock(5 * 60_000)).toBe('5m');
  });
});
