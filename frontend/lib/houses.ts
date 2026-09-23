// House display/sequencing helpers — Houses navigation feature. Hoisted out
// into lib/ rather than inlined in app/houses/page.tsx or
// app/feed/page.tsx, for the same reason feedItems.ts exists as its own
// file (see that file's header comment): this is UI-facing parsing/display
// logic, not an API response shape (api.ts stays exclusively fetch
// wrappers + wire types) and not something that should only be reachable
// via a component-render harness this repo doesn't have (confirmed: no
// @testing-library/react in devDependencies, per feedItems.test.ts's own
// precedent check) when it can just as easily be a plain, directly
// unit-testable function.

export type ParsedHouseParam =
  | { kind: "department"; name: string }
  | { kind: "custom"; id: string };

/**
 * Parses the feed page's `house` query-string parameter into a discriminated
 * House reference, per the `"department:<name>"` vs. bare-id convention
 * (built-in Houses are addressed by department name with a `department:`
 * prefix; custom Houses are addressed by their plain id, no prefix).
 *
 * Returns null for a missing/absent param (`null`) or an empty string —
 * both mean "no House scope requested," i.e. the default unscoped feed.
 *
 * Only the *first* `"department:"` occurrence is treated as the prefix; the
 * remainder (which may itself contain a colon, e.g. a department name with
 * a colon in it) is taken verbatim as the department name, not re-split.
 */
export function parseHouseParam(raw: string | null): ParsedHouseParam | null {
  if (raw == null || raw === "") {
    return null;
  }

  const prefix = "department:";
  if (raw.startsWith(prefix)) {
    return { kind: "department", name: raw.slice(prefix.length) };
  }

  return { kind: "custom", id: raw };
}

/**
 * Formats a custom House's member counts for display on its listing card,
 * e.g. "3 creators · 12 videos". Singular/plural is correct per half, and a
 * zero-count half is omitted entirely rather than printed as "0 creators"
 * or "0 videos" — a House with only videos (no member creators) shows just
 * "N videos", and vice versa. When both counts are zero, returns a
 * dedicated "no members yet" string rather than an empty or degenerate
 * "0 creators · 0 videos" result.
 */
export function formatHouseMemberCount(creatorCount: number, videoCount: number): string {
  if (creatorCount === 0 && videoCount === 0) {
    return "No members yet";
  }

  const parts: string[] = [];
  if (creatorCount > 0) {
    parts.push(`${creatorCount} ${creatorCount === 1 ? "creator" : "creators"}`);
  }
  if (videoCount > 0) {
    parts.push(`${videoCount} ${videoCount === 1 ? "video" : "videos"}`);
  }

  return parts.join(" · ");
}
