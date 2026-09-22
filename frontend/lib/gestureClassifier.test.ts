// Unit tests for the feed's tap/swipe/long-press gesture classifier —
// horizontal-swipe feed redesign. Pure-logic test, no component-render
// harness needed (matches messageDayGroups.test.ts's own precedent note).
import { describe, it, expect } from "vitest";
import {
  classifyPointerUp,
  shouldCancelLongPress,
  MOVE_TOLERANCE,
  SWIPE_THRESHOLD,
  FLICK_VELOCITY_THRESHOLD,
} from "./gestureClassifier";

describe("shouldCancelLongPress", () => {
  it("stays false while movement is within tolerance on both axes", () => {
    expect(shouldCancelLongPress(0, 0)).toBe(false);
    expect(shouldCancelLongPress(MOVE_TOLERANCE, 0)).toBe(false);
    expect(shouldCancelLongPress(0, -MOVE_TOLERANCE)).toBe(false);
  });

  it("becomes true once horizontal movement exceeds tolerance", () => {
    expect(shouldCancelLongPress(MOVE_TOLERANCE + 1, 0)).toBe(true);
    expect(shouldCancelLongPress(-(MOVE_TOLERANCE + 1), 0)).toBe(true);
  });

  it("becomes true once vertical movement exceeds tolerance", () => {
    expect(shouldCancelLongPress(0, MOVE_TOLERANCE + 1)).toBe(true);
    expect(shouldCancelLongPress(0, -(MOVE_TOLERANCE + 1))).toBe(true);
  });
});

describe("classifyPointerUp", () => {
  it("a pure tap: no drag at all resolves to tap regardless of tiny dx/dy", () => {
    const result = classifyPointerUp({ dx: 2, dy: -3, everDragged: false, longPressFired: false });
    expect(result).toEqual({ type: "tap" });
  });

  it("a horizontal swipe left (negative dx) past threshold resolves to swipe next", () => {
    const result = classifyPointerUp({
      dx: -(SWIPE_THRESHOLD + 5),
      dy: 2,
      everDragged: true,
      longPressFired: false,
    });
    expect(result).toEqual({ type: "swipe", direction: "next" });
  });

  it("a horizontal swipe right (positive dx) past threshold resolves to swipe prev", () => {
    const result = classifyPointerUp({
      dx: SWIPE_THRESHOLD + 5,
      dy: 2,
      everDragged: true,
      longPressFired: false,
    });
    expect(result).toEqual({ type: "swipe", direction: "prev" });
  });

  it("exactly at the swipe threshold does NOT count as a swipe (strictly greater-than)", () => {
    const result = classifyPointerUp({
      dx: SWIPE_THRESHOLD,
      dy: 0,
      everDragged: true,
      longPressFired: false,
    });
    expect(result).toEqual({ type: "cancelled" });
  });

  it("a diagonal drag where horizontal dominates resolves to swipe, not cancelled", () => {
    const result = classifyPointerUp({
      dx: -(SWIPE_THRESHOLD + 20),
      dy: SWIPE_THRESHOLD + 5, // still less than |dx|
      everDragged: true,
      longPressFired: false,
    });
    expect(result).toEqual({ type: "swipe", direction: "next" });
  });

  it("a diagonal drag where vertical dominates does NOT resolve to swipe (axis-dominance check)", () => {
    const result = classifyPointerUp({
      dx: -(SWIPE_THRESHOLD + 5),
      dy: SWIPE_THRESHOLD + 20, // now |dy| > |dx|
      everDragged: true,
      longPressFired: false,
    });
    expect(result).toEqual({ type: "cancelled" });
  });

  it("a drag that crosses MOVE_TOLERANCE but never reaches SWIPE_THRESHOLD is cancelled, not a tap or swipe", () => {
    const result = classifyPointerUp({
      dx: MOVE_TOLERANCE + 2,
      dy: 0,
      everDragged: true,
      longPressFired: false,
    });
    expect(result).toEqual({ type: "cancelled" });
  });

  it("longPressFired short-circuits to long-press regardless of final dx/dy", () => {
    const result = classifyPointerUp({
      dx: SWIPE_THRESHOLD + 100,
      dy: SWIPE_THRESHOLD + 100,
      everDragged: true,
      longPressFired: true,
    });
    expect(result).toEqual({ type: "long-press" });
  });

  it("longPressFired short-circuits even when there was no movement at all", () => {
    const result = classifyPointerUp({ dx: 0, dy: 0, everDragged: false, longPressFired: true });
    expect(result).toEqual({ type: "long-press" });
  });
});

describe("classifyPointerUp — velocity-based flick", () => {
  it("a fast short flick left, well under SWIPE_THRESHOLD, still resolves to swipe next", () => {
    const result = classifyPointerUp({
      dx: -(MOVE_TOLERANCE + 5), // past MOVE_TOLERANCE so everDragged is true, but nowhere near SWIPE_THRESHOLD
      dy: 1,
      everDragged: true,
      longPressFired: false,
      velocityX: -(FLICK_VELOCITY_THRESHOLD + 0.2),
    });
    expect(result).toEqual({ type: "swipe", direction: "next" });
  });

  it("a fast short flick right, well under SWIPE_THRESHOLD, still resolves to swipe prev", () => {
    const result = classifyPointerUp({
      dx: MOVE_TOLERANCE + 5,
      dy: 1,
      everDragged: true,
      longPressFired: false,
      velocityX: FLICK_VELOCITY_THRESHOLD + 0.2,
    });
    expect(result).toEqual({ type: "swipe", direction: "prev" });
  });

  it("direction on a qualifying flick follows velocityX's sign, not dx's, when they briefly disagree", () => {
    // A finger that overshoots slightly and rebounds right before release:
    // dx has gone slightly positive, but the release velocity is still
    // clearly leftward — the flick should read as "next", matching what
    // the user's hand was actually doing at the moment of release.
    const result = classifyPointerUp({
      dx: 3,
      dy: 0,
      everDragged: true,
      longPressFired: false,
      velocityX: -(FLICK_VELOCITY_THRESHOLD + 0.3),
    });
    expect(result).toEqual({ type: "swipe", direction: "next" });
  });

  it("exactly at FLICK_VELOCITY_THRESHOLD does NOT qualify (strictly greater-than, matches SWIPE_THRESHOLD's own convention)", () => {
    const result = classifyPointerUp({
      dx: MOVE_TOLERANCE + 5,
      dy: 0,
      everDragged: true,
      longPressFired: false,
      velocityX: FLICK_VELOCITY_THRESHOLD,
    });
    expect(result).toEqual({ type: "cancelled" });
  });

  it("a fast vertical-dominant flick does NOT qualify as a swipe (axis-dominance applies to the flick path too)", () => {
    const result = classifyPointerUp({
      dx: MOVE_TOLERANCE + 2,
      dy: MOVE_TOLERANCE + 20, // |dy| > |dx|
      everDragged: true,
      longPressFired: false,
      velocityX: FLICK_VELOCITY_THRESHOLD + 1, // fast, but wrong axis dominates
    });
    expect(result).toEqual({ type: "cancelled" });
  });

  it("omitting velocityX entirely preserves the original distance-only behavior (backward compatible)", () => {
    const result = classifyPointerUp({
      dx: MOVE_TOLERANCE + 5,
      dy: 0,
      everDragged: true,
      longPressFired: false,
      // no velocityX at all
    });
    expect(result).toEqual({ type: "cancelled" });
  });

  it("a slow drag past SWIPE_THRESHOLD still swipes via the distance path even with velocity under threshold", () => {
    const result = classifyPointerUp({
      dx: -(SWIPE_THRESHOLD + 10),
      dy: 0,
      everDragged: true,
      longPressFired: false,
      velocityX: -0.05, // slow release
    });
    expect(result).toEqual({ type: "swipe", direction: "next" });
  });

  it("longPressFired still short-circuits to long-press even with a qualifying flick velocity present", () => {
    const result = classifyPointerUp({
      dx: -(MOVE_TOLERANCE + 5),
      dy: 0,
      everDragged: true,
      longPressFired: true,
      velocityX: -(FLICK_VELOCITY_THRESHOLD + 1),
    });
    expect(result).toEqual({ type: "long-press" });
  });
});
