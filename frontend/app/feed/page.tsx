"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { getFeed, giveCredit, followCreator, unfollowCreator, getComments, postComment, type Job, type Comment, type FeedResponse } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";
import { isDivider, type FeedItem, type SectionDivider } from "@/lib/feedItems";
import { classifyPointerUp, shouldCancelLongPress, LONG_PRESS_MS } from "@/lib/gestureClassifier";
import { ThumbnailStrip } from "@/components/ThumbnailStrip";

/* ── SVG icon components ─────────────────────────────────────────────────── */
function IconStar({ filled }: { filled: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24"
      fill={filled ? "#fbbf24" : "none"}
      stroke={filled ? "#fbbf24" : "#fff"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill={filled ? "#e08a5f" : "none"}
      stroke={filled ? "#e08a5f" : "#fff"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ── Action button wrapper ───────────────────────────────────────────────── */
function ActionBtn({ onClick, icon, label, active }: {
  onClick: () => void; icon: React.ReactNode; label: string; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none", border: "none", cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: "5px",
        padding: "6px", borderRadius: "8px",
        transition: "transform 0.15s",
      }}
      onMouseDown={e => (e.currentTarget.style.transform = "scale(0.85)")}
      onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
    >
      {icon}
      <span style={{ fontSize: "11px", color: active ? undefined : "rgba(255,255,255,0.75)", fontWeight: 600 }}>
        {label}
      </span>
    </button>
  );
}

/* ── Comment drawer ──────────────────────────────────────────────────────── */
function CommentDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [text, setText]         = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [posting, setPosting]   = useState(false);

  useEffect(() => {
    getComments(jobId)
      .then(setComments)
      .finally(() => setLoading(false));
  }, [jobId]);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      const c = await postComment(jobId, text.trim());
      setComments(prev => [...prev, c]);
      setText("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10,
      }} />
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "min(480px, 100vw)", maxHeight: "60vh",
        background: "var(--surface)", borderRadius: "20px 20px 0 0",
        padding: "16px 20px 24px", zIndex: 11,
        display: "flex", flexDirection: "column", gap: "12px",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.4)",
      }}>
        <div style={{ width: "40px", height: "4px", borderRadius: "999px", background: "var(--border)", margin: "0 auto" }} />
        <p style={{ fontWeight: 700, fontSize: "15px", color: "var(--fg)", textAlign: "center", margin: 0 }}>Comments</p>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", minHeight: "80px" }}>
          {loading ? (
            <p style={{ fontSize: "13px", color: "var(--fg-muted)", textAlign: "center", paddingTop: "20px" }}>Loading…</p>
          ) : comments.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--fg-muted)", textAlign: "center", paddingTop: "20px" }}>No comments yet. Be the first!</p>
          ) : comments.map(c => (
            <div key={c.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <div style={{
                width: "32px", height: "32px", borderRadius: "50%",
                background: "var(--accent)", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "13px", fontWeight: 700, color: "#fff",
              }}>{(c.author_name ?? "?").charAt(0).toUpperCase()}</div>
              <div>
                <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)", margin: 0 }}>{c.author_name ?? "Anonymous"}</p>
                <p style={{ fontSize: "13px", color: "var(--fg)", margin: "2px 0 0" }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: "flex", gap: "8px" }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a comment…"
            style={{
              flex: 1, background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: "999px", padding: "9px 14px", fontSize: "13px",
              color: "var(--fg)", outline: "none",
            }}
          />
          <button type="submit" disabled={posting} style={{
            background: "var(--accent)", color: "#fff", border: "none",
            borderRadius: "999px", padding: "9px 18px", fontSize: "13px",
            fontWeight: 600, cursor: posting ? "not-allowed" : "pointer",
            opacity: posting ? 0.6 : 1,
          }}>Post</button>
        </form>
      </div>
    </>
  );
}

/* ── Swipeable reel card ─────────────────────────────────────────────────── */
// Gesture axis flip (horizontal-swipe feed redesign): the actual tap vs.
// swipe vs. long-press decision now lives in lib/gestureClassifier.ts as a
// pure, unit-tested function — this component is a thin shell around it:
// refs + a long-press timer, calling classifyPointerUp() once per gesture
// and switching on the result. See that module's header comment for the
// full disambiguation rationale (why movement permanently cancels a
// pending long-press rather than re-arming, why the axis-dominance check
// on swipe direction matters now that swipe is horizontal, etc).
// Live drag-follow: while dragging, the card translates horizontally with
// the pointer 1:1; on release it either commits (animates the rest of the
// way off-screen, then fires the nav callback) or snaps back to center.
// SNAP_BACK_MS/COMMIT_MS are separate from gestureClassifier.ts's constants
// deliberately — those govern gesture *recognition* (when is this a swipe),
// these govern animation *timing* (how the visual settles once recognized),
// and conflating them would make future tuning of one silently affect the
// other.
const SNAP_BACK_MS = 220;
const COMMIT_MS = 200;

function SwipeCard({
  children,
  onSwipeNext,
  onSwipePrev,
  onTap,
  onLongPress,
}: {
  children: React.ReactNode;
  onSwipeNext: () => void;
  onSwipePrev: () => void;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const startY          = useRef<number | null>(null);
  const startX          = useRef<number | null>(null);
  const everDragged     = useRef(false);
  const longPressTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired  = useRef(false);

  // Most recent pointermove sample (x, timestamp) and the live horizontal
  // velocity (px/ms) computed between consecutive move events — used for
  // flick detection at release.
  //
  // velocityX is recomputed on every pointermove from the PREVIOUS move to
  // THIS one, and pointerup simply reads its current value rather than
  // computing a fresh move-to-up delta. This distinction matters: a real
  // finger lift is preceded by the OS/browser coalescing move events, so by
  // the time pointerup actually fires the pointer has typically been
  // sitting at its final position for anywhere from ~15-40ms — measuring
  // velocity over that trailing gap systematically undercounts (or zeroes
  // out) a genuinely fast flick, since the flick's real speed happened in
  // the move-to-move segment just before, not in the idle gap after.
  // Confirmed via real-browser testing (Playwright + raw pointer-event
  // timestamp logging): a deliberately fast 20px flick produced consecutive
  // move events ~18ms apart (a real high velocity) followed by a pointerup
  // ~26ms after the LAST move at the SAME x (zero velocity in that final
  // gap) — using the move-to-up delta classified it as a slow drag, not a
  // flick, which was the wrong result for this codebase's move→up
  // approach. Reading the live-tracked velocity instead fixes this.
  //
  // Once everDragged goes false→true never re-flips within a gesture (see
  // shouldCancelLongPress's own semantics), so there's no equivalent
  // "should this reset" concern here — velocityX simply reflects the most
  // recent segment at all times, and resetGestureRefs zeroes it between
  // gestures.
  const lastMove = useRef<{ x: number; t: number } | null>(null);
  const velocityX = useRef(0);

  // Live drag offset (px). Plain state, not a ref: it drives the visible
  // transform every frame, unlike the other gesture bookkeeping above which
  // never needs to trigger a render. containerWidthRef caches the card's
  // own width at drag-start so a "swipe" commit can animate a full
  // off-screen exit without a synchronous layout read on every pointermove.
  const [dragX, setDragX] = useState(0);
  const [phase, setPhase] = useState<"idle" | "dragging" | "settling">("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerWidthRef = useRef(0);

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function resetGestureRefs() {
    startY.current = null;
    startX.current = null;
    everDragged.current = false;
    longPressFired.current = false;
    lastMove.current = null;
    velocityX.current = 0;
    clearLongPressTimer();
  }

  function onPointerDown(e: React.PointerEvent) {
    if (phase === "settling") return; // ignore new gestures until the current commit/snap-back animation finishes
    startY.current = e.clientY;
    startX.current = e.clientX;
    everDragged.current = false;
    longPressFired.current = false;
    lastMove.current = { x: e.clientX, t: e.timeStamp };
    containerWidthRef.current = containerRef.current?.getBoundingClientRect().width ?? 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startY.current === null || startX.current === null) return;
    if (longPressFired.current) return; // strip already open — nothing left to classify
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (!everDragged.current && shouldCancelLongPress(dx, dy)) {
      everDragged.current = true;
      // Movement past tolerance permanently disqualifies this gesture from
      // becoming a long-press — never re-armed even if the pointer later
      // goes still again mid-drag.
      clearLongPressTimer();
    }
    if (everDragged.current) {
      setPhase("dragging");
      setDragX(dx);
    }
    // Live segment velocity — see velocityX's own comment above for why
    // this is computed move-to-move rather than at release time. Guarded
    // against a zero/negative dt (some devices/browsers can coalesce or
    // replay events with an identical or out-of-order timeStamp).
    if (lastMove.current) {
      const dt = e.timeStamp - lastMove.current.t;
      if (dt > 0) velocityX.current = (e.clientX - lastMove.current.x) / dt;
    }
    lastMove.current = { x: e.clientX, t: e.timeStamp };
  }

  function settleTo(target: number, andThen?: () => void) {
    setPhase("settling");
    setDragX(target);
    const ms = target === 0 ? SNAP_BACK_MS : COMMIT_MS;
    window.setTimeout(() => {
      andThen?.();
      // Reset with transitions off (phase "idle") so the incoming card
      // doesn't inherit an outgoing slide animation from x=±exit back to 0.
      setPhase("idle");
      setDragX(0);
    }, ms);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (startY.current === null || startX.current === null) {
      resetGestureRefs();
      return;
    }
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    const result = classifyPointerUp({
      dx,
      dy,
      everDragged: everDragged.current,
      longPressFired: longPressFired.current,
      velocityX: velocityX.current,
    });

    const exitDistance = containerWidthRef.current || 380;

    switch (result.type) {
      case "swipe": {
        const exitX = result.direction === "next" ? -exitDistance : exitDistance;
        settleTo(exitX, result.direction === "next" ? onSwipeNext : onSwipePrev);
        break;
      }
      case "tap":
        settleTo(0);
        onTap();
        break;
      case "long-press":
        // Strip already opened via the timer callback. If the drag tolerance
        // was somehow also crossed first this resolves to long-press
        // regardless (see classifyPointerUp) — still snap the card back so
        // it isn't left visually offset behind the strip.
        settleTo(0);
        break;
      case "cancelled":
        settleTo(0); // sub-threshold drag — snap back to center
        break;
    }

    resetGestureRefs();
  }

  function onPointerCancel() {
    // A real gap in the original implementation, which had no cancel/leave
    // handler at all — low-risk for a 40px-threshold sub-second swipe, but
    // a 3-second hold has a much longer window for something (an OS
    // gesture, browser chrome) to steal the pointer. Must not leave a
    // dangling timer that fires the strip open after the user has moved on,
    // and must not leave the card visually dragged-out with nothing to
    // resolve it.
    if (everDragged.current) settleTo(0);
    resetGestureRefs();
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      tabIndex={0}
      style={{
        position: "relative",
        width: "min(380px, 100%)",
        aspectRatio: "9 / 16",
        background: "#000",
        borderRadius: "20px",
        overflow: "hidden",
        boxShadow: "0 8px 48px rgba(0,0,0,0.7)",
        touchAction: "none",   // prevent browser scroll hijacking on mobile
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none", // suppress iOS Safari's native long-press callout
        cursor: phase === "dragging" ? "grabbing" : "grab",
        transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
        // No transition while actively dragging (phase "dragging") — the
        // transform must track the pointer 1:1 with zero lag. Only the
        // release-triggered settle (phase "settling") animates.
        transition: phase === "settling" ? `transform ${dragX === 0 ? SNAP_BACK_MS : COMMIT_MS}ms ease-out` : "none",
      }}
    >
      {children}
      <span className="sr-only">Press Enter to jump to another video</span>
    </div>
  );
}

/* ── Main feed page ──────────────────────────────────────────────────────── */
export default function FeedPage() {
  const [, setFeed]                     = useState<FeedResponse>({ enrouted: [], recommended: [] });
  const [items, setItems]               = useState<FeedItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [current, setCurrent]           = useState(0);
  const [credited, setCredited]         = useState<Record<string, boolean>>({});
  const [creditCounts, setCreditCounts] = useState<Record<string, number>>({});
  const [saved, setSaved]               = useState<Record<string, boolean>>({});
  const [following, setFollowing]       = useState<Record<string, boolean>>({});
  const [paused, setPaused]             = useState(false);
  const [commenting, setCommenting]     = useState(false);
  const [toast, setToast]               = useState("");
  const [stripOpen, setStripOpen]       = useState(false);
  const videoRefs                       = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    getFeed()
      .then(data => {
        setFeed(data);
        const list: FeedItem[] = [];
        if (data.enrouted.length > 0) {
          list.push({ _divider: true, label: "Following" });
          list.push(...data.enrouted);
        }
        if (data.recommended.length > 0) {
          list.push({ _divider: true, label: "Recommended" });
          list.push(...data.recommended);
        }
        setItems(list);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const videoItems = items.filter((i): i is Job => !isDivider(i));

  useEffect(() => {
    videoItems.forEach(job => {
      const el = videoRefs.current[job.job_id];
      if (!el) return;
      if (items[current] === job) { el.play().catch(() => {}); setPaused(false); }
      else { el.pause(); el.currentTime = 0; }
    });
  }, [current, items, videoItems]);

  const currentJob = !isDivider(items[current]) ? (items[current] as Job) : null;

  const togglePause = useCallback(() => {
    if (!currentJob) return;
    const el = videoRefs.current[currentJob.job_id];
    if (!el) return;
    if (el.paused) { el.play(); setPaused(false); }
    else           { el.pause(); setPaused(true); }
  }, [currentJob]);

  // Long-press-to-reveal thumbnail strip: pauses the current video (reuses
  // the existing `paused` state, not a second flag) before opening, since
  // the strip's own thumbnails never autoplay and leaving the main video
  // running behind it would be wasted decode/network for a view the user
  // isn't looking at. jumpTo reuses setCurrent directly — the existing
  // current-keyed play/pause effect above fires automatically for the new
  // current video, so no special-case play logic is needed on jump.
  const openThumbnailStrip = useCallback(() => {
    if (currentJob) {
      const el = videoRefs.current[currentJob.job_id];
      el?.pause();
      setPaused(true);
    }
    setStripOpen(true);
  }, [currentJob]);

  const jumpTo = useCallback((index: number) => {
    setCurrent(index);
    setStripOpen(false);
  }, []);

  const goNext = useCallback(() => {
    setCurrent(c => {
      let next = c + 1;
      while (next < items.length && isDivider(items[next])) next++;
      return Math.min(next, items.length - 1);
    });
  }, [items]);

  const goPrev = useCallback(() => {
    setCurrent(c => {
      let prev = c - 1;
      while (prev > 0 && isDivider(items[prev])) prev--;
      return Math.max(prev, 0);
    });
  }, [items]);

  // Keyboard navigation still works alongside swipe. Horizontal-swipe feed
  // redesign: ArrowUp/ArrowDown dropped entirely (full replacement, no
  // aliasing) in favor of ArrowRight/ArrowLeft matching the new swipe
  // axis. Enter opens the thumbnail strip (its own keyboard-reachable
  // equivalent of the long-press gesture, which has no natural keyboard
  // analog); Escape closes it — both no-ops while the strip's own
  // Escape/dialog handling isn't mounted, but harmless to check here too
  // for the open case specifically.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (stripOpen) return; // ThumbnailStrip owns its own Escape handling while open
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft")  goPrev();
      if (e.key === " ")          { e.preventDefault(); togglePause(); }
      if (e.key === "Enter")      openThumbnailStrip();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [goNext, goPrev, togglePause, openThumbnailStrip, stripOpen]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }

  function handleShare() {
    navigator.clipboard?.writeText(window.location.href);
    showToast("Link copied!");
  }

  if (loading) return (
    <div style={{ color: "var(--fg-muted)", fontSize: "14px", paddingTop: "80px", textAlign: "center" }}>Loading feed…</div>
  );
  if (error) return (
    <div style={{ color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "10px", padding: "12px 16px", fontSize: "13px" }}>{error}</div>
  );
  if (videoItems.length === 0) return (
    <div style={{ textAlign: "center", paddingTop: "80px", color: "var(--fg-muted)" }}>
      <p style={{ fontSize: "16px", fontWeight: 500 }}>No videos yet.</p>
      <p style={{ fontSize: "13px", marginTop: "6px" }}>Upload filmmaking content to get started.</p>
    </div>
  );

  const currentItem = items[current];
  if (isDivider(currentItem)) setTimeout(() => goNext(), 600);

  const job      = currentJob ?? videoItems[0];
  const initials = (job.creator_name ?? "?").charAt(0).toUpperCase();

  const sectionLabel = (() => {
    for (let i = current; i >= 0; i--) {
      if (isDivider(items[i])) return (items[i] as SectionDivider).label;
    }
    return null;
  })();

  const videoIdx  = videoItems.indexOf(job);
  const isFirst   = videoIdx === 0;
  const isLast    = videoIdx === videoItems.length - 1;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* Section label above card */}
        {sectionLabel && (
          <p style={{
            fontSize: "10px", fontWeight: 700, color: "var(--accent)",
            textTransform: "uppercase", letterSpacing: "0.1em",
            marginBottom: "8px",
          }}>{sectionLabel}</p>
        )}

        {/* Swipeable reel card */}
        <SwipeCard
          onSwipeNext={goNext}
          onSwipePrev={goPrev}
          onTap={togglePause}
          onLongPress={openThumbnailStrip}
        >
          {/* Video */}
          {job.video_url ? (
            <video
              key={job.job_id}
              ref={el => { videoRefs.current[job.job_id] = el; }}
              src={job.video_url}
              playsInline
              onEnded={goNext}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
            />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>No video available</p>
            </div>
          )}

          {/* Pause indicator */}
          {paused && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ width: "60px", height: "60px", borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ display: "flex", gap: "5px" }}>
                  <div style={{ width: "4px", height: "18px", background: "#fff", borderRadius: "2px" }} />
                  <div style={{ width: "4px", height: "18px", background: "#fff", borderRadius: "2px" }} />
                </div>
              </div>
            </div>
          )}

          {/* Swipe hint arrows — subtle, fade out after first swipe.
              Horizontal-swipe feed redesign: repositioned from top/bottom
              to left/right-center to match the new swipe axis. */}
          {!isFirst && (
            <div style={{
              position: "absolute", top: "50%", left: "14px", transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.45)", fontSize: "18px", pointerEvents: "none",
              lineHeight: 1,
            }}>←</div>
          )}
          {!isLast && (
            <div style={{
              position: "absolute", top: "50%", right: "14px", transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.45)", fontSize: "18px", pointerEvents: "none",
              lineHeight: 1,
            }}>→</div>
          )}

          {/* Bottom gradient + creator info */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: "64px",
            padding: "60px 14px 16px",
            background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)",
            pointerEvents: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                background: "var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "15px", fontWeight: 700, color: "#fff",
                border: "2px solid rgba(255,255,255,0.6)", flexShrink: 0,
              }}>{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  <Link
                    href={job.user_id ? `/creators/${job.user_id}` : "#"}
                    style={{ pointerEvents: "all", fontWeight: 700, fontSize: "14px", color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.8)", textDecoration: "none" }}
                  >
                    {job.creator_name ?? "Unknown"}
                  </Link>
                  <span style={{
                    fontSize: "10px", fontWeight: 600, padding: "1px 6px",
                    borderRadius: "999px", background: "var(--accent)",
                    color: "#fff", letterSpacing: "0.3px",
                  }}>CREATOR</span>
                </div>
                {job.creator_department && (
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.65)", margin: "1px 0 0", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
                    {job.creator_department}
                  </p>
                )}
              </div>
            </div>

            {/* Enroute / Deroute */}
            {job.user_id && (
              <button
                onClick={() => {
                  if (!isLoggedIn()) return;
                  const creatorId = job.user_id!;
                  const isF = following[creatorId] ?? false;
                  setFollowing(f => ({ ...f, [creatorId]: !isF }));
                  (isF ? unfollowCreator(creatorId) : followCreator(creatorId)).catch(() =>
                    setFollowing(f => ({ ...f, [creatorId]: isF }))
                  );
                }}
                style={{
                  pointerEvents: "all",
                  padding: "5px 16px", fontSize: "12px", fontWeight: 600,
                  borderRadius: "999px", cursor: "pointer",
                  background: following[job.user_id] ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.9)",
                  color: following[job.user_id] ? "#fff" : "#111",
                  border: "none", backdropFilter: "blur(4px)", transition: "all 0.15s",
                }}
              >
                {following[job.user_id] ? "Deroute" : "Enroute"}
              </button>
            )}
          </div>

          {/* Right-side action buttons */}
          <div style={{
            position: "absolute", right: "10px", bottom: "60px",
            display: "flex", flexDirection: "column", gap: "16px", alignItems: "center",
          }}>
            <ActionBtn
              onClick={async () => {
                if (credited[job.job_id]) return;
                try {
                  const { credits } = await giveCredit(job.job_id);
                  setCredited(c => ({ ...c, [job.job_id]: true }));
                  setCreditCounts(c => ({ ...c, [job.job_id]: credits }));
                } catch { /* silently ignore */ }
              }}
              icon={<IconStar filled={!!credited[job.job_id]} />}
              label={String(creditCounts[job.job_id] ?? 0)}
              active={!!credited[job.job_id]}
            />
            <ActionBtn onClick={() => setCommenting(true)} icon={<IconComment />} label="Comment" />
            <ActionBtn onClick={handleShare} icon={<IconShare />} label="Share" />
            <ActionBtn
              onClick={() => setSaved(s => ({ ...s, [job.job_id]: !s[job.job_id] }))}
              icon={<IconBookmark filled={!!saved[job.job_id]} />}
              label="Save"
              active={!!saved[job.job_id]}
            />
          </div>

          {/* Toast */}
          {toast && (
            <div style={{
              position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: "12px", fontWeight: 600,
              padding: "6px 14px", borderRadius: "999px", whiteSpace: "nowrap",
              pointerEvents: "none",
            }}>{toast}</div>
          )}
        </SwipeCard>

        {/* Counter below card — no buttons */}
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginTop: "12px" }}>
          {videoIdx + 1} / {videoItems.length}
        </p>
      </div>

      {commenting && <CommentDrawer jobId={job.job_id} onClose={() => setCommenting(false)} />}

      {stripOpen && (
        <ThumbnailStrip
          items={items}
          currentIndex={current}
          onJumpTo={jumpTo}
          onClose={() => setStripOpen(false)}
        />
      )}
    </>
  );
}
