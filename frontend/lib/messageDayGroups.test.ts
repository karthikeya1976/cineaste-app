// Unit tests for groupMessagesByDay — the pure day-boundary grouping
// function backing the conversation thread's day separators (R3 / U5,
// messenger channel fixes plan). Proves the interleaving is calendar-day-
// based in the viewer's LOCAL timezone, not duration-based and not a UTC
// comparison, including the exact-midnight-boundary case the plan calls
// out explicitly. Extracted as a plain logic test rather than a full
// component render test — this codebase's vitest setup (see
// vitest.config.ts) has no component-render harness (confirmed: no
// @testing-library/react in devDependencies, no .tsx entries in the
// `include` glob) — matching the precedent in messageRuns.test.ts and
// messageStatus.test.ts.
import { describe, it, expect } from "vitest";
import { groupMessagesByDay } from "./messageDayGroups";
import type { MessageSummary } from "./gatekept-api";

// Minimal MessageSummary factory — only `id` and `sentAt` matter to this
// helper (it never inspects ciphertext/sender/status fields), but the full
// shape is built so the fixtures type-check against the real interface.
function msg(id: string, sentAt: string): MessageSummary {
  return {
    id,
    senderId: "user-a",
    ciphertext: "",
    ciphertextType: "whisper",
    messageNumber: 0,
    attachmentRef: null,
    sentAt,
    deliveredAt: null,
    readAt: null,
    replyToMessageId: null,
    supersedesMessageId: null,
  };
}

describe("groupMessagesByDay", () => {
  it("empty message list -> empty array, no separator", () => {
    expect(groupMessagesByDay([])).toEqual([]);
  });

  it("single message -> just the message, no separator", () => {
    const m = msg("1", "2026-09-18T10:00:00");
    const result = groupMessagesByDay([m]);
    expect(result).toEqual([{ type: "message", message: m }]);
  });

  it("messages all sent the same day -> one contiguous message list, zero separators", () => {
    const a = msg("1", "2026-09-18T09:00:00");
    const b = msg("2", "2026-09-18T12:00:00");
    const c = msg("3", "2026-09-18T20:00:00");
    const result = groupMessagesByDay([a, b, c]);
    expect(result).toEqual([
      { type: "message", message: a },
      { type: "message", message: b },
      { type: "message", message: c },
    ]);
    expect(result.filter((e) => e.type === "separator")).toHaveLength(0);
  });

  it("messages spanning two calendar days -> exactly one separator at the correct boundary", () => {
    const a = msg("1", "2026-09-18T22:00:00");
    const b = msg("2", "2026-09-19T08:00:00");
    const result = groupMessagesByDay([a, b]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "message", message: a });
    expect(result[1].type).toBe("separator");
    if (result[1].type === "separator") {
      expect(result[1].date.getDate()).toBe(new Date(b.sentAt).getDate());
    }
    expect(result[2]).toEqual({ type: "message", message: b });
  });

  it("messages spanning three or more days, including a gap day with zero messages, only separates between days that actually have messages", () => {
    const a = msg("1", "2026-09-15T10:00:00");
    const b = msg("2", "2026-09-16T10:00:00");
    // Gap: no message on 2026-09-17 at all.
    const c = msg("3", "2026-09-18T10:00:00");
    const result = groupMessagesByDay([a, b, c]);

    const separators = result.filter((e) => e.type === "separator");
    // Exactly two separators (before b's day, before c's day) — no
    // separator is synthesized for the empty gap day (17th) since no
    // message was sent on it.
    expect(separators).toHaveLength(2);
    expect(result).toEqual([
      { type: "message", message: a },
      { type: "separator", date: new Date(b.sentAt) },
      { type: "message", message: b },
      { type: "separator", date: new Date(c.sentAt) },
      { type: "message", message: c },
    ]);
  });

  it("two messages one second apart crossing local midnight still get a separator (calendar-day-based, not duration-based)", () => {
    const beforeMidnight = msg("1", "2026-09-18T23:59:59");
    const afterMidnight = msg("2", "2026-09-19T00:00:01");
    const result = groupMessagesByDay([beforeMidnight, afterMidnight]);

    expect(result).toHaveLength(3);
    expect(result[1].type).toBe("separator");
  });

  it("many messages within the same day, however close together, never produce a separator (duration alone is not the trigger)", () => {
    const a = msg("1", "2026-09-18T00:00:00");
    const b = msg("2", "2026-09-18T23:59:59");
    const result = groupMessagesByDay([a, b]);
    expect(result).toEqual([
      { type: "message", message: a },
      { type: "message", message: b },
    ]);
  });
});
