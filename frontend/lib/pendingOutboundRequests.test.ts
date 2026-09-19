// Unit tests for lib/pendingOutboundRequests.ts — the client-side
// outbound-pending tracker backing U8's duplicate-request send-button guard
// (messenger channel fixes plan, R8/KTD10). Pure localStorage-backed logic,
// no network — matches this codebase's established pattern of testing pure
// logic modules directly (see auth.test.ts, gatekept-notifications.test.ts)
// rather than through a component-render harness, which this repo's vitest
// setup does not provide (see messageDayGroups.test.ts's own comment on
// this).
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordOutboundPending,
  hasOutboundPending,
  clearOutboundPending,
  __resetForTests,
} from "./pendingOutboundRequests";

const ME = "user-me";
const OTHER_ME = "user-someone-else";
const RECIPIENT = "user-recipient";

describe("pendingOutboundRequests", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it("no recorded pending request -> hasOutboundPending is false", () => {
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
  });

  it("recording a pending request makes hasOutboundPending true for that pair", () => {
    recordOutboundPending(ME, RECIPIENT);
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(true);
  });

  it("recording a pending request does not affect an unrelated recipient", () => {
    recordOutboundPending(ME, RECIPIENT);
    expect(hasOutboundPending(ME, "some-other-user")).toBe(false);
  });

  it("state is scoped per current-user id — does not leak across accounts in the same browser", () => {
    recordOutboundPending(ME, RECIPIENT);
    expect(hasOutboundPending(OTHER_ME, RECIPIENT)).toBe(false);
  });

  it("clearOutboundPending removes a previously recorded pending request", () => {
    recordOutboundPending(ME, RECIPIENT);
    clearOutboundPending(ME, RECIPIENT);
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
  });

  it("clearing a recipient that was never recorded is a safe no-op", () => {
    expect(() => clearOutboundPending(ME, RECIPIENT)).not.toThrow();
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
  });

  it("survives across separate calls the way localStorage (not sessionStorage) would — persisted, not held only in memory", () => {
    recordOutboundPending(ME, RECIPIENT);
    // Simulate a fresh module read by going straight through the public
    // read path again rather than any cached in-memory value.
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(true);
    expect(localStorage.getItem(`gatekept_outbound_pending:${ME}`)).toContain(RECIPIENT);
  });

  it("tracks multiple distinct recipients independently for the same user", () => {
    recordOutboundPending(ME, "recipient-a");
    recordOutboundPending(ME, "recipient-b");
    expect(hasOutboundPending(ME, "recipient-a")).toBe(true);
    expect(hasOutboundPending(ME, "recipient-b")).toBe(true);
    expect(hasOutboundPending(ME, "recipient-c")).toBe(false);
  });

  it("empty/falsy ids are ignored rather than recorded or matched", () => {
    recordOutboundPending("", RECIPIENT);
    recordOutboundPending(ME, "");
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
    expect(hasOutboundPending("", RECIPIENT)).toBe(false);
  });

  it("malformed stored JSON for a user's key does not throw — fails open (treated as no pending requests)", () => {
    localStorage.setItem(`gatekept_outbound_pending:${ME}`, "{not valid json");
    expect(() => hasOutboundPending(ME, RECIPIENT)).not.toThrow();
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
  });

  it("a non-array value stored under the key is treated as no pending requests", () => {
    localStorage.setItem(`gatekept_outbound_pending:${ME}`, JSON.stringify({ not: "an array" }));
    expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
  });

  it("fails open (returns false, does not throw) when localStorage itself throws on read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    try {
      expect(() => hasOutboundPending(ME, RECIPIENT)).not.toThrow();
      expect(hasOutboundPending(ME, RECIPIENT)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("recordOutboundPending does not throw when localStorage itself throws on write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(() => recordOutboundPending(ME, RECIPIENT)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
