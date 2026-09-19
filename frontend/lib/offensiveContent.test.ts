// Unit tests for getRequestDisplayMode / isConfirmedAbusive — the pure
// fail-closed display-mode decision backing U7's offensive-content banner
// (messenger channel fixes plan, R9/KTD9). Pure logic, no network/DOM —
// matches this codebase's established pattern of testing pure logic
// modules directly (see messageStatus.test.ts, pendingOutboundRequests.test.ts)
// rather than through a component-render harness, which this repo's vitest
// setup does not provide.
import { describe, it, expect } from "vitest";
import { getRequestDisplayMode, isConfirmedAbusive } from "./offensiveContent";

describe("getRequestDisplayMode", () => {
  it('"clean" -> content (explicitly safe)', () => {
    expect(getRequestDisplayMode("clean")).toBe("content");
  });

  it('"uncertain" -> content (explicitly safe, per KTD9\'s exact allowlist)', () => {
    expect(getRequestDisplayMode("uncertain")).toBe("content");
  });

  it('"abusive" -> banner', () => {
    expect(getRequestDisplayMode("abusive")).toBe("banner");
  });

  it("undefined (field absent from the API response) -> banner, NOT content — the fail-closed default", () => {
    expect(getRequestDisplayMode(undefined)).toBe("banner");
  });

  it("null -> banner, NOT content — the fail-closed default", () => {
    expect(getRequestDisplayMode(null)).toBe("banner");
  });

  it("an unrecognized/future scanVerdict string -> banner, not treated as safe by guesswork", () => {
    expect(getRequestDisplayMode("pending_review" as never)).toBe("banner");
  });

  it("an empty string -> banner", () => {
    expect(getRequestDisplayMode("" as never)).toBe("banner");
  });
});

describe("isConfirmedAbusive", () => {
  it('"abusive" -> true', () => {
    expect(isConfirmedAbusive("abusive")).toBe(true);
  });

  it('"clean" -> false', () => {
    expect(isConfirmedAbusive("clean")).toBe(false);
  });

  it('"uncertain" -> false (banner-eligible in some designs, but NOT a confirmed-abusive accept-gate trigger)', () => {
    expect(isConfirmedAbusive("uncertain")).toBe(false);
  });

  it("undefined -> false (banner shows via fail-closed default, but the extra Accept confirmation is scoped to a confirmed abusive verdict only)", () => {
    expect(isConfirmedAbusive(undefined)).toBe(false);
  });

  it("null -> false", () => {
    expect(isConfirmedAbusive(null)).toBe(false);
  });

  it("an unrecognized string -> false", () => {
    expect(isConfirmedAbusive("something_else" as never)).toBe(false);
  });
});
