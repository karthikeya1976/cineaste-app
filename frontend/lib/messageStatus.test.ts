// Unit tests for deriveMessageStatus — the pure state-derivation function
// backing the conversation thread's own-message status ticks (issue #22 /
// U5). Proves the readAt-present -> "read", else deliveredAt-present ->
// "delivered", else -> "sent" precedence, including that a freshly-sent
// message (both null) renders "sent" rather than an error or blank state.
// Extracted as a plain function specifically so this can be a plain logic
// test rather than a full component render test — this codebase's vitest
// setup (see vitest.config.ts) has no component-render harness (confirmed:
// no @testing-library/react in devDependencies, no .tsx entries in the
// `include` glob) — matching the precedent in messageRuns.test.ts.
import { describe, it, expect } from "vitest";
import { deriveMessageStatus } from "./messageStatus";

describe("deriveMessageStatus", () => {
  it("readAt present -> \"read\", regardless of deliveredAt", () => {
    expect(deriveMessageStatus({ deliveredAt: "2026-09-18T00:00:00Z", readAt: "2026-09-18T00:01:00Z" })).toBe("read");
  });

  it("readAt present but deliveredAt null still resolves to \"read\" (backend backfills deliveredAt when marking read)", () => {
    expect(deriveMessageStatus({ deliveredAt: null, readAt: "2026-09-18T00:01:00Z" })).toBe("read");
  });

  it("deliveredAt present, readAt null -> \"delivered\"", () => {
    expect(deriveMessageStatus({ deliveredAt: "2026-09-18T00:00:00Z", readAt: null })).toBe("delivered");
  });

  it("neither set -> \"sent\" (a freshly-sent message, not an error or blank state)", () => {
    expect(deriveMessageStatus({ deliveredAt: null, readAt: null })).toBe("sent");
  });
});
