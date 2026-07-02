// Pure core: duration helpers. NO 'vscode' import.
// The active/paused decision lives in the tracker (it depends on focus, process, and caps).

/**
 * Elapsed time of a session = time already accumulated + time since the start of the current
 * segment. Clamps to the accumulated value if the clock goes backwards (skew/NTP protection).
 */
export function elapsedMs(now: number, sessionStart: number, accumulated: number): number {
  return accumulated + Math.max(0, now - sessionStart);
}

/** Break a duration down into whole hours and minutes (seconds truncated). */
export function hoursMinutes(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** Compact format for tooltips: "2h 05m" above one hour, "5m" below. */
export function formatClock(ms: number): string {
  const { hours, minutes } = hoursMinutes(ms);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** Two-digit zero-padded number, the building block of every clock/date rendering in the core. */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A duration as "H:MM" (e.g. "1:30", "0:45"), for a timesheet total column. */
export function durationHm(ms: number): string {
  const { hours, minutes } = hoursMinutes(ms);
  return `${hours}:${pad2(minutes)}`;
}

/** Local wall-clock time of an instant as "HH:MM" (machine timezone). */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
