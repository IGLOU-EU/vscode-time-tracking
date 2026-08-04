import { describe, it, expect } from 'vitest';
import { createScrollFilter } from './scroll-filter';

const BURST = 1_000;
const CONFIRM = 5_000;
const T0 = 1_700_000_000_000;

const newFilter = () => createScrollFilter({ burstMs: BURST, confirmMs: CONFIRM });

describe('scroll filter', () => {
  it('holds back a lone scroll nothing follows', () => {
    const filter = newFilter();
    expect(filter.accepts(T0)).toBe(false);
  });

  it('holds back the simultaneous scrolls one relayout emits for each visible editor', () => {
    const filter = newFilter();
    expect(filter.accepts(T0)).toBe(false);
    expect(filter.accepts(T0 + 5)).toBe(false);
    expect(filter.accepts(T0 + 9)).toBe(false);
  });

  it('accepts a scroll still going once the burst window has passed', () => {
    const filter = newFilter();
    expect(filter.accepts(T0)).toBe(false);
    expect(filter.accepts(T0 + BURST)).toBe(true);
  });

  it('accepts a confirmation arriving at the very end of the window', () => {
    const filter = newFilter();
    filter.accepts(T0);
    expect(filter.accepts(T0 + CONFIRM)).toBe(true);
  });

  it('refuses a confirmation arriving too late, and waits again from that scroll', () => {
    const filter = newFilter();
    expect(filter.accepts(T0)).toBe(false);
    expect(filter.accepts(T0 + CONFIRM + 1)).toBe(false);
    expect(filter.accepts(T0 + CONFIRM + 1 + BURST)).toBe(true);
  });

  it('asks for a fresh confirmation after an accepted scroll, so a later phantom is held back', () => {
    const filter = newFilter();
    filter.accepts(T0);
    expect(filter.accepts(T0 + BURST)).toBe(true);
    expect(filter.accepts(T0 + BURST + CONFIRM + 1)).toBe(false);
  });

  it('never accepts a relayout burst, however many editors it re-emits', () => {
    const filter = newFilter();
    const results = [0, 3, 7, 11, 40, 120].map((offset) => filter.accepts(T0 + offset));
    expect(results).toEqual([false, false, false, false, false, false]);
  });
});
