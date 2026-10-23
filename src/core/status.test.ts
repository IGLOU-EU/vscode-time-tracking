import { describe, it, expect } from 'vitest';
import { statusModel, type StatusInput } from './status';

const MIN = 60_000;
const tracked: StatusInput = { hasProject: true, phase: 'idle', openMs: 0, countdown: null };

describe('statusModel', () => {
  it('shows a running session with its open time', () => {
    expect(statusModel({ ...tracked, phase: 'active', openMs: 5 * MIN })).toEqual({
      state: 'running',
      openMs: 5 * MIN,
      countdown: null,
    });
  });

  it('counts down the unfocused grace as out, rounding the minutes left up', () => {
    const countdown = { reason: 'inactivity' as const, remainingMs: 4 * MIN + 1 };
    expect(statusModel({ ...tracked, phase: 'active', openMs: 5 * MIN, countdown })).toEqual({
      state: 'running',
      openMs: 5 * MIN,
      countdown: { kind: 'out', minutes: 5 },
    });
  });

  it('counts down the background timeout as out', () => {
    const countdown = { reason: 'background-timeout' as const, remainingMs: 2 * MIN };
    expect(statusModel({ ...tracked, phase: 'active', countdown })).toEqual({
      state: 'running',
      openMs: 0,
      countdown: { kind: 'out', minutes: 2 },
    });
  });

  it.each(['focus-cap', 'debug-cap'] as const)('counts down the %s as idle', (reason) => {
    expect(statusModel({ ...tracked, phase: 'active', countdown: { reason, remainingMs: 3 * MIN } })).toEqual({
      state: 'running',
      openMs: 0,
      countdown: { kind: 'idle', minutes: 3 },
    });
  });

  it('shows the provisional grace as paused, with the minutes left before the focus cap', () => {
    const countdown = { reason: 'focus-cap' as const, remainingMs: 10 * MIN };
    expect(statusModel({ ...tracked, phase: 'grace', countdown })).toEqual({ state: 'grace', idleMinutes: 10 });
  });

  it('shows the provisional grace with no minutes when no countdown runs', () => {
    expect(statusModel({ ...tracked, phase: 'grace' })).toEqual({ state: 'grace', idleMinutes: 0 });
  });

  it.each(['paused', 'pending', 'idle'] as const)('shows the %s phase as it is', (phase) => {
    expect(statusModel({ ...tracked, phase })).toEqual({ state: phase });
  });

  // Nothing is stored without a folder, so a session shown there would be time never recorded.
  it.each(['active', 'grace', 'paused', 'pending', 'idle'] as const)(
    'shows no tracking for the %s phase of a window without a folder',
    (phase) => {
      const countdown = { reason: 'inactivity' as const, remainingMs: 3 * MIN };
      expect(statusModel({ hasProject: false, phase, openMs: 5 * MIN, countdown })).toEqual({ state: 'no-folder' });
    },
  );
});
