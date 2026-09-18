"use client";

// Shared tab row for the three /messages/* pages (compose, requests,
// conversations) — each one previously linked to at most one of its
// siblings (or none at all), so arriving at any of them from the nav
// badge, a deep link, or a bookmark could feel like a dead end even
// though the other two pages exist and work. One shared row keeps the
// three destinations mutually reachable and visually consistent.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/messages", label: "New message" },
  { href: "/messages/requests", label: "Requests" },
  { href: "/messages/conversations", label: "Conversations" },
];

export function MessagesNavTabs() {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              background: active ? "var(--accent)" : "var(--surface)",
              color: active ? "#fff" : "var(--fg)",
              border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "999px",
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
