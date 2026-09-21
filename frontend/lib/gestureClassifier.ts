// Pure tap/swipe/long-press decision logic for the feed's SwipeCard —
// horizontal-swipe feed redesign. Extracted from the pointer-event handlers
// so the actual branching (axis-dominance, threshold comparisons,
// long-press short-circuiting) is unit-testable without a component-render
// harness, matching this repo's existing messageDayGroups.ts-style
// precedent. SwipeCard itself stays a thin shell: refs + timers, calling
// classifyPointerUp() once per gesture and switching on the result.
//
// Three gestures share one pointer-down origin, disambiguated by a
// timer-vs-movement race:
//   - Hold below MOVE_TOLERANCE for the full LONG_PRESS_MS -> long-press.
//   - Movement past MOVE_TOLERANCE at any point -> long-press is cancelled
//     (immediately, unconditionally, and permanently for this gesture —
//     it never re-arms even if the pointer goes still again later, since a
//     real drag-then-pause must not suddenly pop the thumbnail strip).
//   - Released while dragging, past SWIPE_THRESHOLD, with the horizontal
//     delta dominant over the vertical one -> swipe next/prev. This
//     axis-dominance check is the one piece that's new-in-kind versus the
//     original vertical-only feed: with horizontal swipe as the primary
//     gesture, an accidental vertical scroll attempt must not be
//     misread as a swipe.
//   - Released with no meaningful movement -> tap.
//   - Released while dragging but under SWIPE_THRESHOLD -> cancelled
//     (snap back), neither a tap nor a swipe.

export const MOVE_TOLERANCE = 10;
export const SWIPE_THRESHOLD = 40;
export const LONG_PRESS_MS = 3000;

export type GestureResult =
  | { type: "tap" }
  | { type: "swipe"; direction: "next" | "prev" }
  | { type: "long-press" }
  | { type: "cancelled" };

/**
 * True once total movement on either axis exceeds MOVE_TOLERANCE — the
 * signal that disqualifies this gesture from ever becoming a long-press,
 * checked on every pointermove while a long-press timer is still pending.
 */
export function shouldCancelLongPress(dx: number, dy: number): boolean {
  return Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE;
}

/**
 * Classifies a completed gesture at pointer-up time.
 *
 * `everDragged` — did movement cross MOVE_TOLERANCE at any point during
 * this gesture (i.e. did shouldCancelLongPress ever return true)?
 * `longPressFired` — did the long-press timer already fire before this
 * pointer-up? When true, this always resolves to "long-press" regardless
 * of dx/dy — the strip is already open and pointer-up is a no-op for
 * navigation purposes.
 */
export function classifyPointerUp(input: {
  dx: number;
  dy: number;
  everDragged: boolean;
  longPressFired: boolean;
}): GestureResult {
  if (input.longPressFired) {
    return { type: "long-press" };
  }

  if (!input.everDragged) {
    return { type: "tap" };
  }

  const absDx = Math.abs(input.dx);
  const absDy = Math.abs(input.dy);

  if (absDx > SWIPE_THRESHOLD && absDx > absDy) {
    return { type: "swipe", direction: input.dx < 0 ? "next" : "prev" };
  }

  return { type: "cancelled" };
}
