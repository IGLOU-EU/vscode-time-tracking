import { describe, it, expect } from 'vitest';
import { elapsedMs, hoursMinutes, formatClock, durationHm, clockTime } from './activity';

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

describe('durationHm', () => {
  it('formats a duration as H:MM with the minutes padded', () => {
    expect(durationHm(90 * 60_000)).toBe('1:30');
    expect(durationHm(45 * 60_000)).toBe('0:45');
    expect(durationHm(10 * 3_600_000 + 5 * 60_000)).toBe('10:05');
  });
});

describe('clockTime', () => {
  it('formats a local wall-clock time as HH:MM', () => {
    const t = new Date(2026, 6, 1, 9, 5, 0, 0).getTime();
    expect(clockTime(t)).toBe('09:05');
  });
});
