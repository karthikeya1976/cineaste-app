// Unit tests for lib/gatekept-notifications.ts — the shared notification
// store bridging the realtime connection (gatekept-ws.ts) to the nav dot,
// toast stack, and unread-row treatment. Pure logic, no DOM rendering — no
// network — matches lib/auth.test.ts's existing pattern for this repo's
// only prior frontend test file, since no React Testing Library / .tsx
// test infrastructure exists here (see vitest.config.ts's include list:
// lib/**/*.test.ts and app/**/*.test.ts only).
//
// Covers the acceptance-criteria-relevant behaviors directly:
//  - a badge event sets the nav dot visible (frontend AC #1)
//  - clearing on navigation to /messages/requests or /messages/conversations
//    is modeled by clearNavDot() itself — nav-bar.tsx calls this from a
//    pathname effect; that wiring is verified by code review (see the
//    report) since it requires rendering nav-bar.tsx, which this repo has
//    no infrastructure for.
//  - two events in quick succession are two independent notifications
//    (frontend AC #3) — this module fires one listener call per event, no
//    de-duplication/overwriting.
//  - unread-row state per id, cleared independently per id (frontend AC #4).
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordBadgeEvent,
  clearNavDot,
  isNavDotVisible,
  subscribeNavDot,
  clearUnreadChatRequest,
  clearUnreadConversation,
  isChatRequestUnread,
  isConversationUnread,
  subscribeUnreadRows,
  subscribeNotifications,
  __resetForTests,
} from "./gatekept-notifications";

beforeEach(() => {
  __resetForTests();
});

describe("nav dot", () => {
  it("starts hidden", () => {
    expect(isNavDotVisible()).toBe(false);
  });

  it("a chat_request badge event sets the nav dot visible", () => {
    recordBadgeEvent({ reason: "chat_request", chatRequestId: "cr-1", senderId: "u1" });
    expect(isNavDotVisible()).toBe(true);
  });

  it("a message badge event sets the nav dot visible", () => {
    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(isNavDotVisible()).toBe(true);
  });

  it("clearNavDot hides it", () => {
    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(isNavDotVisible()).toBe(true);
    clearNavDot();
    expect(isNavDotVisible()).toBe(false);
  });

  it("clearNavDot is a no-op when already hidden (does not notify subscribers spuriously)", () => {
    const listener = vi.fn();
    subscribeNavDot(listener);
    clearNavDot();
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies subscribers on set and on clear", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNavDot(listener);

    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(listener).toHaveBeenCalledTimes(1);

    clearNavDot();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    recordBadgeEvent({ reason: "message", conversationId: "c-2", senderId: "u1" });
    expect(listener).toHaveBeenCalledTimes(2); // unsubscribed, no further calls
  });
});

describe("unread rows — chat requests", () => {
  it("a chat_request badge event marks that request id unread", () => {
    recordBadgeEvent({ reason: "chat_request", chatRequestId: "cr-1", senderId: "u1" });
    expect(isChatRequestUnread("cr-1")).toBe(true);
    expect(isChatRequestUnread("cr-2")).toBe(false);
  });

  it("clearUnreadChatRequest clears only the specified id", () => {
    recordBadgeEvent({ reason: "chat_request", chatRequestId: "cr-1", senderId: "u1" });
    recordBadgeEvent({ reason: "chat_request", chatRequestId: "cr-2", senderId: "u2" });

    clearUnreadChatRequest("cr-1");

    expect(isChatRequestUnread("cr-1")).toBe(false);
    expect(isChatRequestUnread("cr-2")).toBe(true);
  });

  it("opening a row clears both its bold/dot state on next render (isChatRequestUnread reflects the clear immediately)", () => {
    recordBadgeEvent({ reason: "chat_request", chatRequestId: "cr-1", senderId: "u1" });
    expect(isChatRequestUnread("cr-1")).toBe(true);
    clearUnreadChatRequest("cr-1");
    expect(isChatRequestUnread("cr-1")).toBe(false);
  });
});

describe("unread rows — conversations", () => {
  it("a message badge event marks that conversation id unread", () => {
    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(isConversationUnread("c-1")).toBe(true);
    expect(isConversationUnread("c-2")).toBe(false);
  });

  it("clearUnreadConversation clears only the specified id", () => {
    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    recordBadgeEvent({ reason: "message", conversationId: "c-2", senderId: "u2" });

    clearUnreadConversation("c-1");

    expect(isConversationUnread("c-1")).toBe(false);
    expect(isConversationUnread("c-2")).toBe(true);
  });

  it("notifies unread-row subscribers on both set and clear", () => {
    const listener = vi.fn();
    subscribeUnreadRows(listener);

    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(listener).toHaveBeenCalledTimes(1);

    clearUnreadConversation("c-1");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clearing an id with no unread state does not notify subscribers", () => {
    const listener = vi.fn();
    subscribeUnreadRows(listener);
    clearUnreadConversation("never-marked");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("notification subscribers (toast stack feed)", () => {
  it("two badge events in quick succession both reach subscribers as two separate calls — not one overwriting the other", () => {
    const listener = vi.fn();
    subscribeNotifications(listener);

    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    recordBadgeEvent({ reason: "chat_request", chatRequestId: "cr-1", senderId: "u2" });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { reason: "message", conversationId: "c-1", senderId: "u1", chatRequestId: undefined });
    expect(listener).toHaveBeenNthCalledWith(2, { reason: "chat_request", chatRequestId: "cr-1", senderId: "u2", conversationId: undefined });
  });

  it("unsubscribing stops further delivery", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNotifications(listener);
    unsubscribe();
    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("__resetForTests", () => {
  it("clears all state between tests", () => {
    recordBadgeEvent({ reason: "message", conversationId: "c-1", senderId: "u1" });
    __resetForTests();
    expect(isNavDotVisible()).toBe(false);
    expect(isConversationUnread("c-1")).toBe(false);
  });
});
