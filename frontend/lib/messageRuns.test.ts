// Unit tests for isLastInSenderRun — the run-boundary helper that decides
// where the conversation thread renders an avatar (issue #17 / U8). Proves
// the run-grouping rule produces exactly one avatar-render decision per
// consecutive run of same-sender messages, not one per message, and that
// an interruption by the other side starts a new run rather than merging
// across it. Extracted as a pure function specifically so this can be a
// plain logic test rather than a full component render test — this
// codebase's vitest setup (see vitest.config.ts) has no component-render
// harness (confirmed: no @testing-library/react in devDependencies, no
// .tsx entries in the `include` glob).
import { describe, it, expect } from "vitest";
import { isLastInSenderRun } from "./messageRuns";

const A = "user-a";
const B = "user-b";

function msgs(senderIds: string[]) {
  return senderIds.map((senderId) => ({ senderId }));
}

describe("isLastInSenderRun", () => {
  it("three consecutive messages from the same sender: only the last is last-in-run", () => {
    const messages = msgs([A, A, A]);
    expect(isLastInSenderRun(messages, 0)).toBe(false);
    expect(isLastInSenderRun(messages, 1)).toBe(false);
    expect(isLastInSenderRun(messages, 2)).toBe(true);
  });

  it("a run interrupted by the other participant, then resumed, produces two separate runs", () => {
    // A, A, B, A, A -> other-participant (A) has two runs: indices [0,1]
    // and [3,4], each ending in exactly one last-in-run message, not one
    // avatar shared across the interruption.
    const messages = msgs([A, A, B, A, A]);
    expect(isLastInSenderRun(messages, 0)).toBe(false);
    expect(isLastInSenderRun(messages, 1)).toBe(true); // end of first A-run
    expect(isLastInSenderRun(messages, 2)).toBe(true); // lone B message is its own run
    expect(isLastInSenderRun(messages, 3)).toBe(false);
    expect(isLastInSenderRun(messages, 4)).toBe(true); // end of second A-run

    // Exactly one last-in-run index per run: two total for sender A across
    // its two separate runs, not one shared decision across the interruption.
    const aIndices = [0, 1, 3, 4];
    const aLastInRunCount = aIndices.filter((i) => isLastInSenderRun(messages, i)).length;
    expect(aLastInRunCount).toBe(2);
  });

  it("a single message with no neighbors of the same sender is last-in-run", () => {
    const messages = msgs([A, B, A]);
    expect(isLastInSenderRun(messages, 1)).toBe(true);
  });

  it("the final message in the array is always last-in-run (no next message)", () => {
    const messages = msgs([A, A, B]);
    expect(isLastInSenderRun(messages, messages.length - 1)).toBe(true);
  });

  it("exactly one last-in-run message per run across a longer alternating thread", () => {
    // Runs: [A,A,A], [B], [A], [B,B], [A,A] -> 5 runs total.
    const messages = msgs([A, A, A, B, A, B, B, A, A]);
    const lastInRunFlags = messages.map((_, i) => isLastInSenderRun(messages, i));
    const trueCount = lastInRunFlags.filter(Boolean).length;
    expect(trueCount).toBe(5);
  });
});
