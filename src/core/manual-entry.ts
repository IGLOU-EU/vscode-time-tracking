// Pure core: parse and validate the fields of a manually added time entry. NO 'vscode' import.
// The adapter feeds raw text from its input boxes here and turns the result into a stored interval,
// so all the date/time rules live in one tested place.

import type { Interval } from './intervals';

/** Maximum length of a stored reason, so a free-text entry stays a short label. */
export const MAX_REASON_LENGTH = 32;

/** Trim a reason and cap it at MAX_REASON_LENGTH, leaving its casing untouched. */
export function truncateReason(text: string): string {
  return text.trim().slice(0, MAX_REASON_LENGTH);
}

/**
 * Normalize a reason for storage: truncate (see truncateReason), then capitalize the first letter so
 * a free-text entry matches the look of the preset reasons. The rest of the casing is left untouched
 * (an acronym keeps its capitals). Returns "" when nothing is left after trimming.
 */
export function normalizeReason(text: string): string {
  const trimmed = truncateReason(text);
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : '';
}

/** A calendar date with a 1-based month. */
export interface Ymd {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Parse "HH:MM" (hour may be a single digit) into minutes since midnight, or null if invalid. */
export function parseHhMm(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Parse a strict "YYYY-MM-DD" date, rejecting impossible days (e.g. Feb 30), or null if invalid. */
export function parseYmd(text: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Round-trip through Date to reject a day that rolled over to the next month.
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return { year, month, day };
}

/**
 * Build a local-time interval from a date and start/end minutes since midnight. An end at or before
 * the start rolls over past midnight to the next day, so a night session (e.g. 23:00 to 01:00) is
 * expressible from a single date. Only an equal start and end (a zero-length span) is rejected.
 * Each instant is built through the Date constructor (never midnight plus an offset), so the typed
 * wall-clock time survives DST transition days, and the constructor absorbs the day rollover.
 */
export function composeInterval(ymd: Ymd, startMin: number, endMin: number): Interval | null {
  if (endMin === startMin) return null;
  const atMinutes = (dayOffset: number, minutes: number): number =>
    new Date(ymd.year, ymd.month - 1, ymd.day + dayOffset, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
  return {
    start: atMinutes(0, startMin),
    end: atMinutes(endMin < startMin ? 1 : 0, endMin),
  };
}
