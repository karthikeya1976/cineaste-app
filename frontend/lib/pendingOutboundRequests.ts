// Client-side tracking of the current user's own OUTBOUND pending chat
// requests — U8 (messenger channel fixes plan), R8/KTD10's "duplicate-
// request send-button guard".
//
// Why this exists instead of calling an existing endpoint: the only
// chat-request listing call this app has, listPendingRequests()
// (GET /v1/chat-requests, gatekept-api.ts), returns requests where the
// CURRENT user is the RECIPIENT — every row is keyed by `senderId` (the
// other party), and requests/page.tsx consumes it exactly that way ("People
// who've sent you a first message"). There is no existing frontend call, and
// no existing backend route referenced anywhere in this repo or the plan
// doc, that lists the current user's own SENT pending requests — the
// direction U8 actually needs (are you, the sender, about to send a SECOND
// request to someone you already have one pending with). Gatekept's backend
// lives in a separate repo this unit does not touch, so rather than
// inventing a new server endpoint this unit tracks outbound-pending state
// entirely client-side, seeded at the moment this browser successfully
// sends a request.
//
// This is deliberately a UX nicety, not a security boundary (see KTD10 /
// U8's own approach text: "purely additive UX... the server's existing
// duplicate-index behavior remains the actual backstop"). Consequences of
// that scope:
//   - False negative (this store says "no pending request" but one exists,
//     e.g. sent from a different browser/device, or localStorage was
//     cleared): send button stays enabled, submit goes through, and the
//     server's idx_chat_requests_one_pending / ConflictError path silently
//     absorbs it exactly as it does today for every other duplicate path.
//     Acceptable per U8's explicit scope — "not a bug to over-engineer
//     around".
//   - False positive is structurally impossible here in a way that matters:
//     this module never *invents* a pending id, it only ever remembers ones
//     this browser itself just created. The stale-positive case (recipient
//     already accepted/rejected the request in the time since) is still
//     possible and is explicitly called out as acceptable in U8's Approach
//     ("a race where the request was just accepted").
//
// Persisted in localStorage (not sessionStorage): a chat request can stay
// pending for a long time — losing this state on tab close would silently
// re-enable the exact duplicate-send UX this unit exists to prevent, for no
// benefit. Keyed by current-user id (see key()) so switching accounts in the
// same browser can't leak one user's pending-recipient set into another's.
"use client";

const STORAGE_PREFIX = "gatekept_outbound_pending";

function storageKey(meId: string): string {
  return `${STORAGE_PREFIX}:${meId}`;
}

function readSet(meId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(meId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // Malformed storage, storage disabled/unavailable (e.g. private
    // browsing quota), or any other read failure — treat as "nothing
    // recorded" rather than throwing. Callers of hasOutboundPending() get a
    // safe `false` (fail open — see module comment above and U8's own
    // fail-open requirement).
    return new Set();
  }
}

function writeSet(meId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(storageKey(meId), JSON.stringify(Array.from(ids)));
  } catch {
    // Best-effort persistence only — a write failure just means this
    // recipient won't be remembered as pending next time, which is the same
    // fail-open degraded case as a read failure, not a crash.
  }
}

/**
 * Records that `meId` (the current user) now has an unresolved outbound
 * pending request to `recipientId`. Call this once a sendChatRequest() call
 * has actually succeeded — not before, and not on failure.
 */
export function recordOutboundPending(meId: string, recipientId: string): void {
  if (!meId || !recipientId) return;
  const ids = readSet(meId);
  ids.add(recipientId);
  writeSet(meId, ids);
}

/**
 * True if `meId` is currently tracked (by this browser) as having an
 * unresolved outbound pending request to `recipientId`. Never throws —
 * any underlying storage failure resolves to `false` (fail open), per U8's
 * explicit requirement that a broken check must default to an enabled send
 * button, not a permanently-blocked one.
 */
export function hasOutboundPending(meId: string, recipientId: string): boolean {
  if (!meId || !recipientId) return false;
  return readSet(meId).has(recipientId);
}

/**
 * Clears the tracked pending state for `recipientId`, e.g. once the
 * recipient has resolved the request (accepted/rejected) or the sender
 * withdrew it. No current call site wires this up yet (U8's scope is the
 * compose page's send guard only) — exported for the next unit that adds a
 * sent-requests view or withdraw affordance to use, so that unit doesn't
 * need to duplicate the storage key/shape decisions made here.
 */
export function clearOutboundPending(meId: string, recipientId: string): void {
  if (!meId || !recipientId) return;
  const ids = readSet(meId);
  if (!ids.delete(recipientId)) return;
  writeSet(meId, ids);
}

/** Test-only reset — clears all module state between test cases. */
export function __resetForTests(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    // no-op — nothing to reset if storage isn't available at all
  }
}
