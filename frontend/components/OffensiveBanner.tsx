"use client";

// Offensive-content banner for the requests inbox — U7 (messenger channel
// fixes plan, R9/KTD9). Rendered in place of placeholderDecrypt(req.ciphertext)
// whenever lib/offensiveContent.ts's getRequestDisplayMode() returns
// "banner" — i.e. for a confirmed "abusive" verdict AND, per that helper's
// deliberately fail-closed rule, for any missing/null/unrecognized
// scanVerdict too. This component itself does no verdict logic; it only
// renders the banner it's told to.
//
// STYLING: a visually distinct warning-styled block, not just muted text —
// reuses the same literal warning-amber color CryptoNotice.tsx uses
// (`#fbbf24`, amber-400), since no `--warning` CSS variable exists yet in
// globals.css (confirmed — see CryptoNotice.tsx's own comment on this).
// Matches CryptoNotice's card shape (var(--surface) background, amber
// border) so the two "something's off about this content" surfaces in the
// messenger read consistently rather than inventing a second warning style.
//
// ACCESSIBILITY: carries `role="alert"` so assistive tech doesn't silently
// skip over what is, by design, the most important content in that row —
// following this codebase's established small-status-component convention
// of an explicit semantic role/aria-label rather than an unlabeled div
// (MessageStatusTicks.tsx's aria-label per state, DaySeparator.tsx's
// role="separator" + aria-label, both from the same plan/precedent chain).
const WARNING_COLOR = "#fbbf24"; // amber-400 — same literal used by CryptoNotice.tsx

export function OffensiveBanner() {
  return (
    <div
      role="alert"
      style={{
        borderRadius: "10px",
        border: `1px solid ${WARNING_COLOR}55`,
        background: "var(--surface)",
        padding: "12px 14px",
        fontSize: "13px",
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
      }}
    >
      <span aria-hidden="true" style={{ color: WARNING_COLOR, fontSize: "15px", lineHeight: 1 }}>
        ⚠
      </span>
      <div>
        <p style={{ fontWeight: 600, color: WARNING_COLOR, margin: 0 }}>
          This message was flagged as potentially abusive
        </p>
        <p style={{ marginTop: "4px", color: "var(--fg-muted)", margin: "4px 0 0" }}>
          Its content is hidden. You can still Accept, Dismiss, or Block this request.
        </p>
      </div>
    </div>
  );
}
