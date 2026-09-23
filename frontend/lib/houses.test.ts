// Unit tests for House display/sequencing helpers — Houses navigation
// feature. Pure-logic test, no component-render harness needed.
import { describe, it, expect } from "vitest";
import { parseHouseParam, formatHouseMemberCount } from "./houses";

describe("parseHouseParam", () => {
  it("returns null for a null input (no house param present)", () => {
    expect(parseHouseParam(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseHouseParam("")).toBeNull();
  });

  it("parses a department-prefixed value into a department reference", () => {
    expect(parseHouseParam("department:Editing")).toEqual({
      kind: "department",
      name: "Editing",
    });
  });

  it("round-trips a department name containing no special characters", () => {
    expect(parseHouseParam("department:Cinematography")).toEqual({
      kind: "department",
      name: "Cinematography",
    });
  });

  it("parses a bare id with no department: prefix as a custom house reference", () => {
    expect(parseHouseParam("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toEqual({
      kind: "custom",
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
  });
});

describe("formatHouseMemberCount", () => {
  it('returns a "no members yet" style string for zero creators and zero videos, not "0 creators · 0 videos"', () => {
    const result = formatHouseMemberCount(0, 0);
    expect(result).not.toContain("0 creators");
    expect(result).not.toContain("0 videos");
    expect(result.toLowerCase()).toContain("no members");
  });

  it("uses singular \"creator\" and omits the videos half when there is 1 creator and 0 videos", () => {
    const result = formatHouseMemberCount(1, 0);
    expect(result).toBe("1 creator");
    expect(result).not.toContain("video");
  });

  it("uses singular \"video\" and omits the creators half when there are 0 creators and 1 video", () => {
    const result = formatHouseMemberCount(0, 1);
    expect(result).toBe("1 video");
    expect(result).not.toContain("creator");
  });

  it("uses plural forms and shows both halves when there are multiple of each", () => {
    const result = formatHouseMemberCount(3, 12);
    expect(result).toBe("3 creators · 12 videos");
  });
});
