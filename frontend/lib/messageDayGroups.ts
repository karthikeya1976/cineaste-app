// Day-grouping helper for the conversation thread's message list — R3 / U5
// (messenger channel fixes plan). Extracted as a plain, pure function
// (rather than inlined in the render loop) so the day-boundary rule itself
// is unit-testable under this repo's existing lib/**/*.test.ts convention
// (see vitest.config.ts's `include`), matching the precedent set by
// messageRuns.ts's isLastInSenderRun and messageStatus.ts's
// deriveMessageStatus — no component-render test harness exists here (no
// @testing-library/react, no .tsx entries in vitest's `include` glob).
//
// Rule (per the plan's own wording, not left to interpretation): a day
// boundary is a change in CALENDAR day in the viewer's LOCAL timezone, not
// a UTC calendar day and not an elapsed-duration threshold. Two messages
// one second apart that straddle local midnight still get a separator;
// two messages many hours apart that never cross local midnight do not.
import type { MessageSummary } from "./gatekept-api";

export type DayGroupEntry =
  | { type: "separator"; date: Date }
  | { type: "message"; message: MessageSummary };

/**
 * Returns the local calendar-day key (e.g. "2026-09-18") for a message's
 * `sentAt` timestamp, using `Date`'s local-timezone accessors
 * (getFullYear/getMonth/getDate) rather than any UTC/ISO-slice shortcut —
 * an ISO-string slice would silently reintroduce UTC-day comparison, which
 * is exactly what this helper must NOT do.
 */
function localDayKey(sentAt: string): string {
  const d = new Date(sentAt);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Interleaves the flat, chronologically-ordered `messages` array with
 * `{ type: "separator" }` entries wherever the local calendar day changes
 * between one message and the next. A separator's `date` is the later
 * message's own `sentAt` (as a Date), i.e. the day being entered.
 *
 * - Empty input -> empty output (no separator).
 * - A single message -> just that message, no separator.
 * - Gap days with zero messages produce no separator of their own — this
 *   is a function of the actual messages present, not of calendar days
 *   walked, so a multi-day gap between two messages still yields exactly
 *   one separator (for the day the second message lands on), not one per
 *   skipped day.
 */
export function groupMessagesByDay(messages: readonly MessageSummary[]): DayGroupEntry[] {
  const result: DayGroupEntry[] = [];
  let previousDayKey: string | null = null;

  for (const message of messages) {
    const dayKey = localDayKey(message.sentAt);
    if (previousDayKey !== null && dayKey !== previousDayKey) {
      result.push({ type: "separator", date: new Date(message.sentAt) });
    }
    result.push({ type: "message", message });
    previousDayKey = dayKey;
  }

  return result;
}
