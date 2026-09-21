"use client";

// One thumbnail slot inside the feed's long-press thumbnail strip —
// horizontal-swipe feed redesign. Split out from ThumbnailStrip.tsx
// because it owns its own local `hasError` lifecycle (per-thumbnail load
// failure handling), which would otherwise pollute the strip's
// scroll/windowing logic.
//
// Renders a real <video preload="metadata" muted> element rather than an
// <img> — this paints the video's first frame for free once metadata
// loads, without fetching or playing the full file, and without any
// backend thumbnail_url field or canvas/CORS handling (see the plan's
// rationale: canvas-capturing a frame from a cross-origin S3 presigned URL
// risks a tainted canvas depending on bucket CORS config; a plain <video>
// element sidesteps that entirely since nothing reads pixel data back
// out). This is a SEPARATE pool of video elements from the main player's
// videoRefs in feed/page.tsx — never live-playing, never touching that
// component's play/pause effect.
import { useState } from "react";
import type { Job } from "@/lib/api";
import { initialFor } from "@/components/Avatar";

const THUMBNAIL_WIDTH = 64;
const THUMBNAIL_GAP = 8;

// Exported so ThumbnailStrip's windowing math (computeVisibleWindow) and
// this component's own fixed sizing can never drift apart.
export const THUMBNAIL_ITEM_WIDTH = THUMBNAIL_WIDTH + THUMBNAIL_GAP;

export interface VideoThumbnailProps {
  job: Job;
  active: boolean;
  /** false outside the windowed range — renders a static placeholder
   *  instead of a live <video> element, so the strip never mounts more
   *  than WINDOW_RADIUS*2+1 video elements at once regardless of total
   *  feed length. */
  live: boolean;
  onSelect: () => void;
}

export function VideoThumbnail({ job, active, live, onSelect }: VideoThumbnailProps) {
  const [hasError, setHasError] = useState(false);
  const showPlaceholder = !live || hasError || !job.video_url;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Jump to video by ${job.creator_name ?? "Unknown"}`}
      aria-current={active ? "true" : undefined}
      style={{
        position: "relative",
        flexShrink: 0,
        width: `${THUMBNAIL_WIDTH}px`,
        height: `${(THUMBNAIL_WIDTH * 16) / 9}px`,
        marginRight: `${THUMBNAIL_GAP}px`,
        borderRadius: "10px",
        overflow: "hidden",
        border: active ? "2px solid var(--accent)" : "2px solid transparent",
        transform: active ? "scale(1.08)" : "scale(1)",
        transition: "transform 150ms ease-out, border-color 150ms ease-out",
        background: "#000",
        padding: 0,
        cursor: "pointer",
        scrollSnapAlign: "center",
      }}
    >
      {showPlaceholder ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "18px",
            fontWeight: 700,
          }}
        >
          {initialFor(job.creator_name ?? "?")}
        </div>
      ) : (
        <video
          src={job.video_url ?? undefined}
          preload="metadata"
          muted
          playsInline
          onError={() => setHasError(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
        />
      )}
    </button>
  );
}
