// Visible, unmissable disclosure that this build's web client does not yet
// perform real end-to-end encryption in the browser (see lib/gatekept-crypto.ts
// for why — @signalapp/libsignal-client has no WASM build). Shown wherever a
// user is about to send or read something they might reasonably assume is
// encrypted, so the placeholder crypto is never silently passed off as real.
//
// Restyled from gatekept/web/components/CryptoNotice.tsx for Editor Club's
// design system: the source hardcoded light-theme Tailwind classes
// (bg-amber-50/text-amber-900 with dark: variants) that don't fit Editor
// Club's single fixed dark palette (see frontend/app/globals.css — there is
// no dark: variant system here). Uses the same CSS-variable-via-inline-style
// convention as the rest of the app, with a warning-amber accent color kept
// literal (no --warning token exists yet in globals.css) the same way other
// pages here use literal colors for status accents (e.g. app/search/page.tsx's
// #f87171/#e08a5f error/info colors — #e08a5f is the peach-tinted replacement
// for the prior selenium-blue #7ba3ff this comment used to reference).

const WARNING_COLOR = "#fbbf24"; // amber-400 — literal, no --warning token defined in globals.css yet

export function CryptoNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        fontSize: "12px", color: WARNING_COLOR,
      }}>
        <span aria-hidden style={{
          width: "6px", height: "6px", borderRadius: "50%", background: WARNING_COLOR, flexShrink: 0,
        }} />
        Demo build — not encrypted yet
      </span>
    );
  }

  return (
    <div style={{
      borderRadius: "10px", border: `1px solid ${WARNING_COLOR}55`,
      background: "var(--surface)", padding: "12px 16px", fontSize: "13px",
    }}>
      <p style={{ fontWeight: 600, color: WARNING_COLOR, margin: 0 }}>
        This web client does not yet encrypt messages.
      </p>
      <p style={{ marginTop: "4px", color: "var(--fg-muted)" }}>
        The backend&apos;s protocol (Signal Protocol, real X3DH + Double Ratchet) is
        fully implemented and tested — but the library it uses only runs natively,
        not in a browser. Messages sent from this web client are placeholder text,
        clearly marked as such, until a browser-compatible build is added.
      </p>
    </div>
  );
}
