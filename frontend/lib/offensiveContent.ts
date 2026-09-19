// Fail-closed display-mode decision for the requests inbox — U7 (messenger
// channel fixes plan, R9/KTD9). Extracted as a plain, pure function so the
// decision rule itself is unit-testable under this repo's existing
// lib/**/*.test.ts convention (see vitest.config.ts's `include`) — no
// component-render test harness exists here (no @testing-library/react, no
// .tsx entries in vitest's `include` glob), matching the precedent set by
// messageStatus.ts's deriveMessageStatus and messageRuns.ts's
// isLastInSenderRun.
//
// THE RULE (deliberately fail-CLOSED, not fail-open — spelled out explicitly
// by the plan because the naive/obvious default is the wrong one here):
// content is safe to render UNLESS scanVerdict is exactly "clean" or
// "uncertain". Concretely: "clean" -> show content, "uncertain" -> show
// content, "abusive" -> banner, missing/undefined -> banner, null -> banner,
// any other/unrecognized string -> banner.
//
// This inverts the naive "missing field -> show content" default on purpose:
// this display path exists specifically to prevent showing flagged content,
// so a permissive default would silently defeat that purpose during any
// deploy-skew window (backend ships scanVerdict before frontend does, or a
// future backend change drops/renames the field) or any verdict value this
// frontend build doesn't yet recognize.
export type ScanVerdict = "clean" | "abusive" | "uncertain" | null | undefined;

export type RequestDisplayMode = "content" | "banner";

const SAFE_VERDICTS: ReadonlySet<string> = new Set(["clean", "uncertain"]);

/**
 * Decides whether a chat request's plaintext/decrypted content is safe to
 * render, or whether the offensive-content banner must be shown instead.
 * Fail-closed: only an exact "clean" or "uncertain" match returns "content".
 * Everything else — including "abusive", missing, null, or any unrecognized
 * string — returns "banner".
 */
export function getRequestDisplayMode(scanVerdict: ScanVerdict): RequestDisplayMode {
  if (typeof scanVerdict === "string" && SAFE_VERDICTS.has(scanVerdict)) {
    return "content";
  }
  return "banner";
}

/** Convenience predicate mirroring getRequestDisplayMode for call sites that
 *  only need the boolean (e.g. gating the Accept-confirmation step, which
 *  per KTD9 applies specifically to scanVerdict === "abusive" rows — NOT to
 *  every banner row, since an "unrecognized value" banner isn't a confirmed
 *  abuse verdict). Kept separate from getRequestDisplayMode intentionally:
 *  the banner-vs-content decision and the "is this specifically a confirmed
 *  abusive verdict" decision are different questions that happen to overlap
 *  only partially. */
export function isConfirmedAbusive(scanVerdict: ScanVerdict): boolean {
  return scanVerdict === "abusive";
}
