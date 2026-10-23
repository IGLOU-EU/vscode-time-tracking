// Pure core: what the status bar shows, as a state and the numbers it carries. The adapter puts
// them into words. NO 'vscode' import.
import type { PauseReason, TrackPhase } from './tracker';

export interface StatusInput {
  /** Whether a folder is open, which is where the time of a session is stored. */
  readonly hasProject: boolean;
  readonly phase: TrackPhase;
  readonly openMs: number;
  readonly countdown: { readonly reason: PauseReason; readonly remainingMs: number } | null;
}

export type StatusModel =
  | { readonly state: 'no-folder' | 'idle' | 'pending' | 'paused' }
  | { readonly state: 'grace'; readonly idleMinutes: number }
  | {
      readonly state: 'running';
      readonly openMs: number;
      readonly countdown: { readonly kind: 'idle' | 'out'; readonly minutes: number } | null;
    };

export function statusModel(input: StatusInput): StatusModel {
  // A window without a folder stores nothing, so a session shown there would be time never saved.
  if (!input.hasProject) return { state: 'no-folder' };
  const { phase, openMs, countdown } = input;
  const minutesLeft = countdown ? Math.ceil(countdown.remainingMs / 60_000) : 0;
  // The unfocused out-grace held provisionally looks paused, with the idle countdown to the cap.
  if (phase === 'grace') return { state: 'grace', idleMinutes: minutesLeft };
  if (phase !== 'active') return { state: phase };
  if (!countdown) return { state: 'running', openMs, countdown: null };
  // While idle and counting down toward a pause: "out" for the unfocused grace and the background
  // timeout, "idle" toward a safety cap (focus or debug).
  const idle = countdown.reason === 'focus-cap' || countdown.reason === 'debug-cap';
  return { state: 'running', openMs, countdown: { kind: idle ? 'idle' : 'out', minutes: minutesLeft } };
}
