"use client";

// Small presentational "{name} is typing…" row — issue #33 / U7 / plan
// docs/plans/2026-09-18-001-feat-seamless-chat-experience-plan.md, KTD5.
//
// ACCESSIBILITY: wrapped in a container with `aria-live="polite"`,
// matching MessageToast.tsx's existing convention for transient,
// non-focus-grabbing real-time UI (see that file's own container) — a
// screen-reader user gets the same "they're typing" cue a sighted user
// sees appear and disappear automatically.
//
// LAYOUT: this component is purely presentational and always renders its
// row once mounted — it never reserves visual space on its own because the
// CALLER (the conversation page) controls whether it's mounted at all
// (`{otherIsTyping && <TypingIndicator ... />}`), per that page's own
// placement rule (a fixed row BETWEEN the scrollable message list and the
// compose input form, outside the scrollRef-managed scroll container).
export interface TypingIndicatorProps {
  name: string;
}

export function TypingIndicator({ name }: TypingIndicatorProps) {
  return (
    <div
      style={{
        minHeight: "20px",
        fontSize: "12px",
        color: "var(--fg-muted)",
        padding: "2px 4px",
      }}
      aria-live="polite"
    >
      {name} is typing…
    </div>
  );
}
