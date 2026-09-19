// Unit tests for copyToClipboard — the clipboard helper backing the
// per-message Copy action (R4 / U6, messenger channel fixes plan). Mocks
// `navigator.clipboard` directly rather than exercising a real browser
// clipboard, matching this codebase's existing pure-logic-test convention
// (no component-render harness — see messageDayGroups.test.ts's own header
// comment).
import { describe, it, expect, afterEach, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore whatever jsdom's default navigator looked like, in case a
    // prior test replaced it entirely.
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });

  it("writes the given text via navigator.clipboard.writeText and resolves true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const result = await copyToClipboard("hello world");

    expect(writeText).toHaveBeenCalledWith("hello world");
    expect(result).toBe(true);
  });

  it("copies exactly the plaintext string it's given, unmodified", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await copyToClipboard("decrypted plaintext, not ciphertext");

    expect(writeText).toHaveBeenCalledWith("decrypted plaintext, not ciphertext");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("returns false without throwing when navigator.clipboard is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    await expect(copyToClipboard("x")).resolves.toBe(false);
  });

  it("returns false without throwing when writeText rejects (e.g. permission denied)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await expect(copyToClipboard("x")).resolves.toBe(false);
  });
});
