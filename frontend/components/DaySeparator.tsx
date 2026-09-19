"use client";

// Centered day-boundary separator for the conversation thread — R3 / U5
// (messenger channel fixes plan). Rendered by groupMessagesByDay's
// "separator" entries, between message groups that fall on different local
// calendar days (see lib/messageDayGroups.ts for the day-boundary rule
// itself — this component is purely presentational and does no date-math
// beyond formatting the `date` it's given).
//
// ICONOGRAPHY: uses lucide-react's Clock icon — this codebase already
// depends on lucide-react (nav-bar.tsx imports Home/Search/Upload/User/
// MessageCircle from it), so a clock-style icon here reuses the existing
// dependency rather than introducing a new one or falling back to a raw
// unicode glyph.
//
// ACCESSIBILITY: carries `role="separator"` with an `aria-label` matching
// the visible date text, following this codebase's established
// aria-label-on-small-status-component convention (MessageStatusTicks.tsx's
// per-state labels, the requests list's `aria-label="Unread"` dot) — this
// announces distinctly from the surrounding message content to assistive
// tech rather than being silently skipped as decorative.
import { Clock } from "lucide-react";

export interface DaySeparatorProps {
  date: Date;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function DaySeparator({ date }: DaySeparatorProps) {
  const label = formatDayLabel(date);

  return (
    <div
      role="separator"
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        margin: "4px 0",
      }}
    >
      <span style={{ flex: 1, height: "1px", background: "var(--border)" }} />
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "11px",
          fontWeight: 500,
          color: "var(--fg-muted)",
          whiteSpace: "nowrap",
        }}
      >
        <Clock size={12} aria-hidden="true" />
        {label}
      </span>
      <span style={{ flex: 1, height: "1px", background: "var(--border)" }} />
    </div>
  );
}
