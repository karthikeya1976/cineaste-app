// Run-boundary helper for avatar placement in the conversation thread —
// issue #17 / U8 (seamless chat plan). Extracted as a plain, pure function
// (rather than inlined in the .map() loop) so the run-grouping rule itself
// is unit-testable under this repo's existing lib/**/*.test.ts convention
// (see vitest.config.ts's `include`), without needing a component-render
// test harness this codebase doesn't have (no @testing-library/react, no
// .tsx entries in vitest's `include` glob — checked before writing this).
//
// Rule (per the issue, specified precisely rather than left to "chat app
// convention" alone): a message is "last in its sender's run" when the
// next message in the array has a different senderId, or there is no next
// message at all. The avatar in the conversation page renders only for
// other-participant messages where this returns true — every other
// same-sender message in the run gets a blank spacer instead, so bubble
// left edges stay aligned within the run.
export function isLastInSenderRun(
  messages: readonly { senderId: string }[],
  index: number
): boolean {
  const next = messages[index + 1];
  return next === undefined || next.senderId !== messages[index].senderId;
}
