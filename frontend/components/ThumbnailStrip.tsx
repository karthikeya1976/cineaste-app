"use client";

// Long-press-revealed thumbnail strip — horizontal-swipe feed redesign.
// Opened by holding a video for 3 seconds (see SwipeCard's onLongPress in
// app/feed/page.tsx), lets the user jump directly to any video in the feed
// instead of swiping one at a time.
//
// Renders the SAME flat `items` array FeedPage already holds (not just the
// video subset) — dividers render as small non-interactive label chips so
// section context ("Following"/"Recommended") isn't lost while scanning,
// consistent with `current` never being allowed to land on a divider
// elsewhere in the app. Never holds its own copy of `current`/`items`;
// receives both as props and writes only through onJumpTo/onClose — this
// is deliberate, so there is exactly one source of truth for "which index
// is current" (FeedPage's `current` state).
//
// No virtualization library: only mounts live <video> elements (via
// VideoThumbnail's `live` prop) within a windowed range around the
// scroll-derived center index, computed by feedItems.ts's
// computeVisibleWindow — pure arithmetic, never per-item
// getBoundingClientRect() measurement. Justified by realistic feed sizes
// (dozens of items, not thousands) per this codebase's "add libraries only
// when a real need arises" convention — see the plan doc for the full
// rationale against react-window/react-virtual here.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isDivider, type FeedItem } from "@/lib/feedItems";
import { computeVisibleWindow } from "@/lib/feedItems";
import { VideoThumbnail, THUMBNAIL_ITEM_WIDTH } from "@/components/VideoThumbnail";
import type { Job } from "@/lib/api";

const WINDOW_RADIUS = 8;
const DISMISS_SWIPE_THRESHOLD = 60;

export interface ThumbnailStripProps {
  items: FeedItem[];
  currentIndex: number;
  onJumpTo: (index: number) => void;
  onClose: () => void;
}

export function ThumbnailStrip({ items, currentIndex, onJumpTo, onClose }: ThumbnailStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef(0);
  const [visibleWindow, setVisibleWindow] = useState({ start: 0, end: items.length });
  const rafPending = useRef(false);
  const dragStartY = useRef<number | null>(null);

  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const recomputeWindow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    containerWidthRef.current = el.clientWidth;
    setVisibleWindow(
      computeVisibleWindow(el.scrollLeft, THUMBNAIL_ITEM_WIDTH, el.clientWidth, WINDOW_RADIUS, items.length)
    );
  }, [items.length]);

  // Scroll-to-center the current item on open, then compute the initial
  // visible window. useLayoutEffect so this happens before paint — no
  // visible jump from an un-centered initial render.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetOffsetLeft = currentIndex * THUMBNAIL_ITEM_WIDTH;
    el.scrollTo({
      left: targetOffsetLeft - el.clientWidth / 2 + THUMBNAIL_ITEM_WIDTH / 2,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    recomputeWindow();
    // Intentionally only re-runs when currentIndex changes (opening the
    // strip fresh) or the item count changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, items.length]);

  // requestAnimationFrame-throttled scroll handler: read scrollLeft once
  // per frame, not once per raw scroll event (which can fire dozens of
  // times per frame on some browsers) — the layout-thrash-avoidance
  // decision from the plan.
  function handleScroll() {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      recomputeWindow();
    });
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Swipe-the-strip-down-to-dismiss: a simple local vertical-drag check,
  // not routed through gestureClassifier.ts (that module is specific to
  // the main card's tap/swipe/long-press triad). Gesture-axis-safe
  // against the strip's own horizontal scroll since it only reacts to
  // vertical movement.
  function handlePointerDown(e: React.PointerEvent) {
    dragStartY.current = e.clientY;
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    if (dy > DISMISS_SWIPE_THRESHOLD) onClose();
  }

  function handleSelect(index: number) {
    onJumpTo(index);
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 20 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to video"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 21,
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
          borderRadius: "16px 16px 0 0",
          padding: "16px 0",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          boxShadow: "0 -4px 40px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ width: "40px", height: "4px", borderRadius: "999px", background: "var(--border)", margin: "0 auto 12px" }} />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            display: "flex",
            overflowX: "auto",
            padding: "0 16px",
            WebkitOverflowScrolling: "touch",
            scrollSnapType: "x proximity",
            overscrollBehaviorX: "contain",
          }}
        >
          {items.map((item, index) => {
            if (isDivider(item)) {
              return (
                <div
                  key={`divider-${index}`}
                  style={{
                    flexShrink: 0,
                    width: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      color: "var(--fg-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      writingMode: "vertical-rl",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                  </span>
                </div>
              );
            }

            const live = index >= visibleWindow.start && index < visibleWindow.end;
            return (
              <VideoThumbnail
                key={(item as Job).job_id}
                job={item as Job}
                active={index === currentIndex}
                live={live}
                onSelect={() => handleSelect(index)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
