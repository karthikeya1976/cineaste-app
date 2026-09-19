// Unit tests for the supersession resolution helper (KTD5 / U6, messenger
// channel fixes plan) — proves the resolution map, the "always resolves to
// latest edit" rule, the concurrent-edit tie-break (latest sentAt wins,
// ties broken by higher id), and the reply-target lookup (including the
// "referenced message not in currently-loaded history" fallback case, per
// KTD6). Pure-logic test, matching the precedent set by
// messageDayGroups.test.ts / messageStatus.test.ts / messageRuns.test.ts —
// no component-render harness exists in this codebase's vitest setup.
import { describe, it, expect } from "vitest";
import {
  buildSupersessionMap,
  resolveMessage,
  resolveReplyTarget,
} from "./messageSupersession";
import type { MessageSummary } from "./gatekept-api";

function msg(overrides: Partial<MessageSummary> & { id: string; sentAt: string }): MessageSummary {
  return {
    senderId: "user-a",
    ciphertext: "",
    ciphertextType: "whisper",
    messageNumber: 0,
    attachmentRef: null,
    deliveredAt: null,
    readAt: null,
    replyToMessageId: null,
    supersedesMessageId: null,
    ...overrides,
  };
}

describe("buildSupersessionMap", () => {
  it("a message with no supersedesMessageId is not a key in the map", () => {
    const a = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const map = buildSupersessionMap([a]);
    expect(map.size).toBe(0);
  });

  it("a single edit maps the original's id to the edit row", () => {
    const original = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const edit = msg({ id: "b", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const map = buildSupersessionMap([original, edit]);
    expect(map.get("a")).toBe(edit);
  });

  it("edit-of-edit both targeting the original resolves to the LATEST sentAt", () => {
    const original = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const firstEdit = msg({ id: "b", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const secondEdit = msg({ id: "c", sentAt: "2026-09-18T10:10:00Z", supersedesMessageId: "a" });
    // Order in the input array should not matter — feed them out of order.
    const map = buildSupersessionMap([secondEdit, original, firstEdit]);
    expect(map.get("a")).toBe(secondEdit);
  });

  it("concurrent-edit tie-break: identical sentAt is broken by the HIGHER id", () => {
    const original = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const editLowId = msg({ id: "b1", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const editHighId = msg({ id: "b2", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const map = buildSupersessionMap([original, editLowId, editHighId]);
    expect(map.get("a")).toBe(editHighId);
  });

  it("tie-break is order-independent (same result regardless of array order)", () => {
    const original = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const editLowId = msg({ id: "b1", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const editHighId = msg({ id: "b2", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const mapReversed = buildSupersessionMap([editHighId, editLowId, original]);
    expect(mapReversed.get("a")).toBe(editHighId);
  });

  it("multiple distinct originals each resolve independently", () => {
    const a = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const b = msg({ id: "b", sentAt: "2026-09-18T10:00:00Z" });
    const editA = msg({ id: "a2", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const editB = msg({ id: "b2", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "b" });
    const map = buildSupersessionMap([a, b, editA, editB]);
    expect(map.get("a")).toBe(editA);
    expect(map.get("b")).toBe(editB);
  });
});

describe("resolveMessage", () => {
  it("returns the message itself when it has never been superseded", () => {
    const a = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const map = buildSupersessionMap([a]);
    expect(resolveMessage(a, map)).toBe(a);
  });

  it("returns the latest superseding row's content at the original's position", () => {
    const original = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const edit = msg({ id: "b", sentAt: "2026-09-18T10:05:00Z", supersedesMessageId: "a" });
    const map = buildSupersessionMap([original, edit]);
    expect(resolveMessage(original, map)).toBe(edit);
  });
});

describe("resolveReplyTarget", () => {
  it("returns null when the referenced message isn't in the currently-loaded history", () => {
    const map = buildSupersessionMap([]);
    expect(resolveReplyTarget("missing-id", [], map)).toBeNull();
  });

  it("returns the referenced message when present and never edited", () => {
    const a = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const map = buildSupersessionMap([a]);
    expect(resolveReplyTarget("a", [a], map)).toBe(a);
  });

  it("resolves THROUGH supersession — a reply to a later-edited message shows the CURRENT content, not the reply-time wording (KTD6)", () => {
    const original = msg({ id: "a", sentAt: "2026-09-18T10:00:00Z" });
    const edit = msg({ id: "b", sentAt: "2026-09-18T10:10:00Z", supersedesMessageId: "a" });
    const messages = [original, edit];
    const map = buildSupersessionMap(messages);

    // A reply sent at 10:05 (before the edit at 10:10) still resolves its
    // quoted preview to the edit, since resolution is always "current
    // state," not "state at reply time."
    expect(resolveReplyTarget("a", messages, map)).toBe(edit);
  });
});
