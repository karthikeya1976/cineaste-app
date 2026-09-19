"use client";

// Per-message action menu — R4 / U6 (messenger channel fixes plan, KTD8).
//
// No dropdown/menu primitive exists anywhere in this frontend (confirmed —
// no Radix dropdown despite @radix-ui/react-progress and
// @radix-ui/react-slot already being dependencies, no shadcn/ui per this
// repo's own removed-shadcn convention). Built from scratch, inline-styled
// per this codebase's CSS-variable convention (var(--surface),
// var(--border), var(--fg), var(--accent)), matching the existing
// small-single-purpose-component pattern (MessageStatusTicks.tsx,
// AttachmentPicker.tsx).
//
// TRIGGER IS ALWAYS RENDERED, NEVER HOVER-GATED (explicit plan decision,
// not to be re-litigated): a hover-only trigger has no equivalent on touch
// devices, and this codebase has no established touch-fallback pattern to
// lean on — so the "..." trigger renders unconditionally on every bubble
// and works identically on desktop and touch from the start. The visible
// glyph is small, but the clickable button itself is sized to at least a
// 44x44px effective hit area (via padding, not just the glyph's own
// intrinsic size) per the plan's explicit touch-target requirement.
//
// ICONOGRAPHY: the trigger uses a plain unicode ellipsis ("⋯"), not a
// lucide-react icon — this lucide-react version (^1.20.0, checked in
// node_modules/lucide-react/dist/lucide-react.d.ts) has no
// MoreVertical/MoreHorizontal export, so introducing a differently-shaped
// "menu trigger" icon from a totally different glyph family would be worse
// than the plain-unicode fallback this codebase already establishes as
// acceptable (MessageStatusTicks.tsx's own checkmark glyphs, for the same
// "no existing convention to match" reason). The menu items themselves DO
// use lucide-react (Copy/Reply/Flag/Pencil), matching DaySeparator.tsx's
// existing use of the same dependency for a small inline icon.
//
// DISMISS-ON-OUTSIDE-CLICK + ESCAPE-TO-CLOSE + VIEWPORT-EDGE AVOIDANCE: all
// three are explicit plan requirements. Outside-click is handled via a
// document-level mousedown listener (attached only while open), Escape via
// a document-level keydown listener (same lifetime), and viewport-edge
// avoidance via a simple post-open measurement pass that flips the menu
// from below-right (the default) to above and/or left of the trigger if it
// would otherwise overflow — mirroring how MessageToast.tsx already
// anchors fixed-position UI within the viewport rather than assuming
// unlimited space.
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { Copy, Reply, Flag, Pencil } from "lucide-react";

export type MessageAction = "copy" | "reply" | "report" | "edit";

export interface MessageActionMenuProps {
  /** Received messages get ["copy","reply","report"]; sent messages get
   *  ["edit","reply","copy"] — passed in as props (per KTD8) so the same
   *  component serves both message directions without hard-coding either
   *  order/set internally. Never rendered at all for an abusive-banner
   *  placeholder row (U7's concern) — callers simply don't mount this
   *  component for that row. */
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
  /** Accessible label for the trigger button, e.g. "Message actions". */
  triggerLabel?: string;
}

const ACTION_LABEL: Record<MessageAction, string> = {
  copy: "Copy",
  reply: "Reply",
  report: "Report",
  edit: "Edit",
};

const ACTION_ICON: Record<MessageAction, React.ReactNode> = {
  copy: <Copy size={14} aria-hidden="true" />,
  reply: <Reply size={14} aria-hidden="true" />,
  report: <Flag size={14} aria-hidden="true" />,
  edit: <Pencil size={14} aria-hidden="true" />,
};

export function MessageActionMenu({ actions, onAction, triggerLabel = "Message actions" }: MessageActionMenuProps) {
  const [open, setOpen] = useState(false);
  // "below" (default) or "above" the trigger; "left" or "right"-anchored —
  // computed after open, once the menu's real dimensions and the trigger's
  // viewport position are known.
  const [placement, setPlacement] = useState<{ vertical: "above" | "below"; horizontal: "left" | "right" }>({
    vertical: "below",
    horizontal: "right",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss-on-outside-click + Escape-to-close — both plan requirements,
  // both scoped to only listen while the menu is actually open.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Viewport-edge avoidance: after the menu mounts (open just became true),
  // measure its bounding box against the viewport and flip above/left if it
  // would otherwise overflow the bottom/right edge. useLayoutEffect so this
  // happens before paint — the menu is positioned correctly on first frame
  // rather than visibly jumping.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const overflowsBottom = rect.bottom > window.innerHeight;
    const overflowsRight = rect.right > window.innerWidth;
    setPlacement({
      vertical: overflowsBottom ? "above" : "below",
      horizontal: overflowsRight ? "left" : "right",
    });
  }, [open]);

  function handleSelect(action: MessageAction) {
    setOpen(false);
    onAction(action);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          // Visible glyph is small, but the clickable area meets the
          // plan's 44x44px effective hit-area requirement via padding on
          // a fixed-size button, not just font-size.
          width: "32px",
          height: "32px",
          minWidth: "44px",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: "8px",
          color: "var(--fg-muted)",
          cursor: "pointer",
          fontSize: "16px",
          lineHeight: 1,
          padding: 0,
          // Shrinks the visual footprint back down without shrinking the
          // actual hit target — negative margin compensates for the
          // oversized min-width/min-height so this trigger doesn't blow up
          // the bubble row's layout.
          margin: "-6px",
        }}
      >
        ⋯
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={triggerLabel}
          style={{
            position: "absolute",
            zIndex: 50,
            top: placement.vertical === "below" ? "calc(100% + 4px)" : undefined,
            bottom: placement.vertical === "above" ? "calc(100% + 4px)" : undefined,
            right: placement.horizontal === "left" ? 0 : undefined,
            left: placement.horizontal === "right" ? 0 : undefined,
            minWidth: "140px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            padding: "4px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(action)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "13px",
                fontWeight: 500,
                color: action === "report" ? "#f87171" : "var(--fg)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--bg)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {ACTION_ICON[action]}
              {ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
