"use client";

// Small presentational sent/delivered/read status-tick indicator — issue #22
// / U5 (seamless chat plan, final unit). Rendered next to the CURRENT USER'S
// OWN messages only in the conversation thread (never on the other
// participant's messages — a recipient never needs to see their own read
// status of someone else's message).
//
// DESIGN — fully specified by the issue, not left to further judgment:
//   "sent":      single check mark, var(--fg-muted), regular weight.
//   "delivered": double check mark, var(--fg-muted), regular weight.
//   "read":      double check mark, var(--accent), BOLD weight (fontWeight
//                700, matching this app's existing "emphasized" convention,
//                e.g. Avatar's initial text) — distinguishable from
//                "delivered" by BOTH color AND weight together, not color
//                alone, so a color-vision-deficient user can still tell the
//                two apart.
//
// ICONOGRAPHY: plain unicode check-mark characters, not a lucide-react icon.
// lucide-react is a dependency (nav-bar.tsx imports Home/Search/Upload/User/
// MessageCircle from it), but nothing in this codebase already uses it for a
// checkmark/status-tick glyph — there's no existing convention to match by
// switching to it here, so unicode text (✓ / ✓✓) is the simpler, dependency-
// free choice per the issue's own "otherwise plain text/unicode is fine".
//
// ACCESSIBILITY: the containing element carries `aria-label="Sent"` /
// `"Delivered"` / `"Read"` (exact capitalized strings), mirroring the
// existing `aria-label="Unread"` convention already used on the small
// color-only status dot in messages/conversations/page.tsx and
// messages/requests/page.tsx — this codebase's established pattern for
// labeling a small non-text status glyph, followed here rather than
// introducing an unlabeled one.
export type MessageStatusState = "sent" | "delivered" | "read";

export interface MessageStatusTicksProps {
  state: MessageStatusState;
}

const ARIA_LABEL: Record<MessageStatusState, string> = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

const GLYPH: Record<MessageStatusState, string> = {
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
};

export function MessageStatusTicks({ state }: MessageStatusTicksProps) {
  return (
    <span
      aria-label={ARIA_LABEL[state]}
      style={{
        fontSize: "11px",
        lineHeight: 1,
        color: state === "read" ? "var(--accent)" : "var(--fg-muted)",
        fontWeight: state === "read" ? 700 : 400,
        letterSpacing: "-1px",
      }}
    >
      {GLYPH[state]}
    </span>
  );
}
