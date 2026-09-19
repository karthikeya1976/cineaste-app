// Status-state derivation for the conversation thread's own-message ticks —
// issue #22 / U5 (seamless chat plan, final unit). Extracted as a plain,
// pure function (rather than inlined in the .map() loop) so the derivation
// rule itself is unit-testable under this repo's existing lib/**/*.test.ts
// convention (see vitest.config.ts's `include`), matching the precedent set
// by messageRuns.ts's isLastInSenderRun — no component-render test harness
// exists here (no @testing-library/react, no .tsx entries in vitest's
// `include` glob), so pure-logic extraction is how this codebase covers
// render-adjacent decisions with tests.
//
// Rule (per the issue's own wording, not left to interpretation): readAt
// present -> "read", else deliveredAt present -> "delivered", else -> "sent".
// A freshly-sent message (both null) renders "sent", never an error or a
// blank state.
import type { MessageStatusState } from "@/components/MessageStatusTicks";

export function deriveMessageStatus(message: {
  deliveredAt: string | null;
  readAt: string | null;
}): MessageStatusState {
  if (message.readAt) return "read";
  if (message.deliveredAt) return "delivered";
  return "sent";
}
