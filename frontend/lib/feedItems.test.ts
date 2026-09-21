// Unit tests for feed sequencing helpers — horizontal-swipe feed redesign.
// Pure-logic test, no component-render harness needed.
import { describe, it, expect } from "vitest";
import { isDivider, computeVisibleWindow, type FeedItem, type SectionDivider } from "./feedItems";
import type { Job } from "./api";

function job(id: string): Job {
  return {
    job_id: id,
    filename: `${id}.mp4`,
    status: "done",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function divider(label: string): SectionDivider {
  return { _divider: true, label };
}

describe("isDivider", () => {
  it("returns true for a divider item", () => {
    expect(isDivider(divider("Following"))).toBe(true);
  });

  it("returns false for a Job item", () => {
    expect(isDivider(job("a"))).toBe(false);
  });

  it("returns false for undefined (e.g. an out-of-range index)", () => {
    const items: FeedItem[] = [job("a")];
    expect(isDivider(items[5])).toBe(false);
  });
});

describe("computeVisibleWindow", () => {
  it("returns an empty range when there are no items", () => {
    expect(computeVisibleWindow(0, 64, 320, 8, 0)).toEqual({ start: 0, end: 0 });
  });

  it("clamps the start of the window to 0 near the beginning of the list", () => {
    const { start, end } = computeVisibleWindow(0, 64, 320, 8, 100);
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(0);
  });

  it("clamps the end of the window to totalItems near the end of the list", () => {
    const totalItems = 20;
    const itemWidth = 64;
    // Scroll all the way to the last item.
    const scrollLeft = (totalItems - 1) * itemWidth;
    const { start, end } = computeVisibleWindow(scrollLeft, itemWidth, 320, 8, totalItems);
    expect(end).toBe(totalItems);
    expect(start).toBeLessThan(totalItems);
  });

  it("produces a symmetric radius around the centered index in the middle of a long list", () => {
    const itemWidth = 64;
    const containerWidth = 320;
    const totalItems = 100;
    const centerIndex = 50;
    // scrollLeft such that centerIndex lands in the middle of the viewport.
    const scrollLeft = centerIndex * itemWidth - containerWidth / 2;
    const { start, end } = computeVisibleWindow(scrollLeft, itemWidth, containerWidth, 8, totalItems);
    expect(start).toBe(centerIndex - 8);
    expect(end).toBe(centerIndex + 8 + 1);
  });

  it("returns the whole list, with no negative or out-of-range indices, when radius exceeds totalItems", () => {
    const { start, end } = computeVisibleWindow(0, 64, 320, 1000, 10);
    expect(start).toBe(0);
    expect(end).toBe(10);
  });
});
