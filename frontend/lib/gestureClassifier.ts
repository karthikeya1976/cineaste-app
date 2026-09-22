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
//   - Released while dragging, UNDER SWIPE_THRESHOLD but with the release
//     velocity past FLICK_VELOCITY_THRESHOLD (and horizontal-dominant) ->
//     also swipe next/prev. A fast short flick reads as an intentional
//     swipe even if the finger didn't travel the full 40px — matches
//     native carousel/reel feel, where speed matters as much as distance.
//     Velocity is the *instantaneous* rate at release (last pointermove
//     sample to pointerup), not an average over the whole gesture, so a
//     drag that starts fast then pauses before release does NOT count as
//     a flick — the user visibly stopped, so distance alone should decide.
//   - Released with no meaningful movement -> tap.
//   - Released while dragging but under both SWIPE_THRESHOLD and the flick
//     velocity check -> cancelled (snap back), neither a tap nor a swipe.

export const MOVE_TOLERANCE = 10;
export const SWIPE_THRESHOLD = 40;
export const LONG_PRESS_MS = 3000;
// px/ms. ~0.5 is a brisk flick (e.g. 40px in ~80ms) — fast enough that a
// deliberate slow drag well under SWIPE_THRESHOLD won't accidentally
// qualify, but low enough to catch a real quick flick that only travels
// 15-20px before release.
export const FLICK_VELOCITY_THRESHOLD = 0.5;

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
 * `velocityX` — optional, instantaneous horizontal px/ms at release (signed
 * the same way as dx: negative = moving left/"next"). Omitted or 0 simply
 * disables the flick path, falling back to distance-only classification —
 * every pre-existing call site that doesn't pass it keeps its original
 * behavior unchanged.
 */
export function classifyPointerUp(input: {
  dx: number;
  dy: number;
  everDragged: boolean;
  longPressFired: boolean;
  velocityX?: number;
}): GestureResult {
  if (input.longPressFired) {
    return { type: "long-press" };
  }

  if (!input.everDragged) {
    return { type: "tap" };
  }

  const absDx = Math.abs(input.dx);
  const absDy = Math.abs(input.dy);
  const horizontalDominant = absDx > absDy;

  if (absDx > SWIPE_THRESHOLD && horizontalDominant) {
    return { type: "swipe", direction: input.dx < 0 ? "next" : "prev" };
  }

  const absVelocity = Math.abs(input.velocityX ?? 0);
  if (horizontalDominant && absVelocity > FLICK_VELOCITY_THRESHOLD) {
    return { type: "swipe", direction: (input.velocityX ?? 0) < 0 ? "next" : "prev" };
  }

  return { type: "cancelled" };
}
