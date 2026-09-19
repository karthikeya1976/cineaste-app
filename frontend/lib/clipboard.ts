// Clipboard helper — KTD8 / U6 (messenger channel fixes plan).
//
// Extracted as a small standalone module because, as of this unit, it gains
// a second call site: the existing inline `handleShare` in
// `app/feed/page.tsx` (`navigator.clipboard?.writeText(window.location.href)`)
// and the new per-message Copy action in MessageActionMenu.tsx. Per KTD8,
// `feed/page.tsx`'s existing inline copy is deliberately NOT refactored to
// use this helper — that would be a drive-by change to unrelated, working
// code, out of scope for this unit. Only the new call site (message Copy)
// uses this.
//
// copyToClipboard always copies PLAINTEXT — for the message-copy call site
// specifically, callers must pass the already-decrypted text (see
// gatekept-crypto.ts's placeholderDecrypt), never ciphertext. This module
// has no opinion on what string it's given; that guarantee lives at the
// call site.
//
// Returns a boolean rather than throwing so callers can show a lightweight
// inline "Copied" / "Couldn't copy" state without a try/catch at every call
// site. `navigator.clipboard` can be undefined (older browsers, insecure
// contexts, some test/SSR environments) or its `writeText` call can reject
// (permissions denied) — both are treated as a clean `false` return, not an
// unhandled rejection.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
