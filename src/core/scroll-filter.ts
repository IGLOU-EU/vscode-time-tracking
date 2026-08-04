// Pure core: tell a real scroll from a phantom one, to decide if it may START a session.
// NO 'vscode' import.
//
// A layout change (window resized, a monitor plugged or unplugged, a panel toggled) makes VSCode
// re-emit the visible ranges of every visible editor, which reads as a scroll nobody performed and
// used to start a session on its own. Such a burst is isolated: it lands in one instant and
// nothing follows. A real gesture keeps producing signals, so a scroll only confirms a session
// once a second one follows it, and that second one must be at least burstMs apart, otherwise the
// second editor of a split view would confirm the first.
//
// This only applies from rest. Inside a running session an isolated scroll is indistinguishable
// from someone reviewing line by line (scroll, think, scroll), and dropping it would let the focus
// safety cap trim real work, so the tracker keeps taking it.

export interface ScrollFilterConfig {
  burstMs: number; // signals closer than this belong to the same relayout, not to a new gesture
  confirmMs: number; // a held scroll counts only if another one follows it within this window
}

export interface ScrollFilter {
  /** True when the scroll is confirmed and may start a session. A lone one is held back instead. */
  accepts(at: number): boolean;
}

export function createScrollFilter({ burstMs, confirmMs }: ScrollFilterConfig): ScrollFilter {
  let heldAt = Number.NEGATIVE_INFINITY;

  return {
    accepts(at) {
      const held = at - heldAt;
      if (held >= burstMs && held <= confirmMs) {
        heldAt = Number.NEGATIVE_INFINITY; // confirmed, the next lone scroll starts a fresh wait
        return true;
      }
      if (held > confirmMs) heldAt = at; // out of the blue: wait and see what follows
      return false; // nothing to confirm, or same relayout so it cannot confirm itself
    },
  };
}
