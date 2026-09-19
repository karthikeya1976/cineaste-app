// Supersession resolution helper — KTD5 / U6 (messenger channel fixes
// plan). Extracted as a plain, pure function (matching the precedent set by
// messageDayGroups.ts, messageRuns.ts, messageStatus.ts) so the resolution
// and tie-break rules are unit-testable under this repo's existing
// lib/**/*.test.ts convention — no component-render test harness exists
// here (no @testing-library/react, no .tsx entries in vitest.config.ts's
// `include` glob).
//
// An "edit" is never an in-place ciphertext mutation (Double Ratchet
// forward secrecy makes that impossible — see KTD5's rationale in the
// plan). Instead it's a brand-new message row carrying
// `supersedesMessageId` pointing at the ORIGINAL message's id (edit-of-edit
// still targets the original, not the immediately-prior edit — Signal's
// `targetSentTimestamp`-always-targets-original convention). The thread
// view must therefore resolve, for each original message, which
// (potentially several) superseding rows target it, and pick the single
// authoritative "current" one.
//
// CONCURRENT-EDIT TIE-BREAK (KTD5, applied identically everywhere a
// supersedes_message_id map is built — this is the one shared
// implementation so no call site can silently diverge): the server does
// not reject a second edit targeting an already-superseded original (a
// retried request after a timeout, or two concurrently open sessions, can
// both produce a row superseding the same original). Resolution picks:
//   1. the row with the LATEST `sentAt`
//   2. ties (identical `sentAt`) broken by the HIGHER `id` (lexicographic
//      string comparison, since ids are UUIDs — not a numeric comparison)
import type { MessageSummary } from "./gatekept-api";

/**
 * Compares two candidate superseding rows for the same original message
 * per KTD5's tie-break rule. Returns a positive number if `a` should win
 * over `b`, negative if `b` should win, 0 only if they are indistinguishable
 * (same sentAt and same id — i.e. the same row).
 */
function supersessionWinner(a: MessageSummary, b: MessageSummary): MessageSummary {
  const aTime = new Date(a.sentAt).getTime();
  const bTime = new Date(b.sentAt).getTime();
  if (aTime !== bTime) return aTime > bTime ? a : b;
  return a.id > b.id ? a : b;
}

/**
 * Builds a map from an ORIGINAL message's id to the single authoritative
 * message that currently supersedes it (per KTD5's tie-break rule), across
 * the full given message list. A message with no `supersedesMessageId` set
 * is not itself a key in this map (only IDs that have actually been
 * superseded by at least one other row appear) — callers should treat a
 * missing key as "not edited."
 *
 * Only one level of "what supersedes this original" is ever resolved
 * (matching KTD5's "always target original, not chain-of-edits"
 * convention) — a row that itself has `supersedesMessageId` set is still
 * eligible to be looked up as a *target* (in case a malformed/legacy row
 * points at an edit rather than the true original), but this function does
 * not walk multi-hop chains; it simply groups by whatever
 * `supersedesMessageId` value each row carries.
 */
export function buildSupersessionMap(
  messages: readonly MessageSummary[]
): Map<string, MessageSummary> {
  const map = new Map<string, MessageSummary>();

  for (const m of messages) {
    const targetId = m.supersedesMessageId;
    if (!targetId) continue;

    const current = map.get(targetId);
    map.set(targetId, current ? supersessionWinner(current, m) : m);
  }

  return map;
}

/**
 * Resolves a single message to whatever currently supersedes it (or itself,
 * if nothing does) using a pre-built supersession map. This is the per-row
 * lookup the thread render loop and quoted-preview resolution (KTD6) both
 * use — a quoted preview resolves `replyToMessageId` THROUGH supersession
 * (shows the referenced message's current/edited content, not its
 * reply-time wording), using this exact same map and rule, per KTD6's
 * explicit "not pinning quotes to pre-edit wording" decision.
 */
export function resolveMessage(
  message: MessageSummary,
  supersessionMap: ReadonlyMap<string, MessageSummary>
): MessageSummary {
  return supersessionMap.get(message.id) ?? message;
}

/**
 * Looks up a reply's referenced message by id (resolved through
 * supersession, per KTD6) from the currently-loaded message list. Returns
 * null if the referenced message isn't present in the currently-loaded
 * history window — callers render the muted "original message unavailable"
 * fallback in that case, per KTD6, rather than erroring.
 */
export function resolveReplyTarget(
  replyToMessageId: string,
  messages: readonly MessageSummary[],
  supersessionMap: ReadonlyMap<string, MessageSummary>
): MessageSummary | null {
  const original = messages.find((m) => m.id === replyToMessageId);
  if (!original) return null;
  return resolveMessage(original, supersessionMap);
}
