// Feed sequencing helpers — horizontal-swipe feed redesign. Hoisted out of
// app/feed/page.tsx (where SectionDivider/isDivider originally lived
// inline) rather than into lib/api.ts, since these are UI-sequencing
// concepts (how the feed's flat item list is structured for display), not
// API response shapes — api.ts stays exclusively fetch wrappers + wire
// types.
import type { Job } from "./api";

export type SectionDivider = { _divider: true; label: string };
export type FeedItem = Job | SectionDivider;

export function isDivider(item: FeedItem | undefined): item is SectionDivider {
  return item != null && "_divider" in item;
}

/**
 * Computes the index range [start, end) of feed items that should have a
 * LIVE thumbnail (real <video> element) mounted in the long-press
 * thumbnail strip, given the strip's current horizontal scroll position.
 * Everything outside this range renders a static placeholder instead, so
 * only a bounded number of video elements are ever live at once regardless
 * of total feed length.
 *
 * Pure arithmetic (scrollLeft / itemWidth), never a per-item
 * getBoundingClientRect() measurement — the layout-thrash-avoidance
 * decision this helper exists to encode. Requires every item to render at
 * the same fixed itemWidth (including its gap) for this arithmetic to
 * hold.
 *
 * Returned range is clamped to [0, totalItems) and is safe to call with a
 * radius larger than totalItems (the whole list is returned as visible,
 * with no negative or out-of-range indices).
 */
export function computeVisibleWindow(
  scrollLeft: number,
  itemWidth: number,
  containerWidth: number,
  radius: number,
  totalItems: number
): { start: number; end: number } {
  if (totalItems <= 0 || itemWidth <= 0) {
    return { start: 0, end: 0 };
  }

  const centerIndex = Math.floor((scrollLeft + containerWidth / 2) / itemWidth);
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(totalItems, centerIndex + radius + 1);

  return { start, end };
}
