// Unit tests for the feed's tap/swipe/long-press gesture classifier —
// horizontal-swipe feed redesign. Pure-logic test, no component-render
// harness needed (matches messageDayGroups.test.ts's own precedent note).
import { describe, it, expect } from "vitest";
import {
  classifyPointerUp,
  shouldCancelLongPress,
  MOVE_TOLERANCE,
  SWIPE_THRESHOLD,
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
