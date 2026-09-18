// Unit tests for components/Avatar.tsx's initial-extraction logic.
//
// This codebase's vitest config (vitest.config.ts) only includes
// lib/**/*.test.ts and app/**/*.test.ts, and has no @testing-library/react
// (or any component-render harness) in devDependencies — confirmed before
// writing this file, per the issue's own instruction to check existing
// precedent rather than assume one exists. Avatar.tsx's actual rendering is
// a thin, static JSX wrapper around this pure function, so the logic worth
// testing — uppercased-first-character extraction and the empty/whitespace
// fallback — is tested directly as a plain function here, matching this
// repo's existing lib/*.test.ts convention (see auth.test.ts,
// gatekept-attachments.test.ts) rather than as a rendered-component test.
import { describe, it, expect } from "vitest";
import { initialFor } from "../components/Avatar";

describe("Avatar's initialFor()", () => {
  it("returns the uppercased first character for a normal name", () => {
    expect(initialFor("ada")).toBe("A");
    expect(initialFor("Ada Lovelace")).toBe("A");
    expect(initialFor("zoe")).toBe("Z");
  });

  it("returns a sensible fallback character for an empty-string name", () => {
    expect(initialFor("")).toBe("?");
  });

  it("returns the fallback for a whitespace-only name rather than a blank glyph", () => {
    expect(initialFor("   ")).toBe("?");
  });

  it("ignores leading whitespace when extracting the initial", () => {
    expect(initialFor("  bob")).toBe("B");
  });
});
