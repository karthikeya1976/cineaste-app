"use client";

// Conversation list — adapted from gatekept/web/app/conversations/page.tsx.
// The source showed only a raw "{c.otherParticipantId.slice(0, 8)}…"; this
// version batch-resolves every participant ID on the page to a real name via
// resolveUserNames(), falling back to an id fragment if a lookup misses.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listConversations, listPendingRequests, resolveUserNames, ensureRegistered, type ConversationSummary } from "@/lib/gatekept-api";
import { Avatar } from "@/components/Avatar";
import { isLoggedIn } from "@/lib/auth";
import { isConversationUnread, clearUnreadConversation, subscribeUnreadRows } from "@/lib/gatekept-notifications";

const STATUS_LABEL: Record<ConversationSummary["status"], string> = {
  active: "Active",
  blocked_by_a: "Blocked",
  blocked_by_b: "Blocked",
  closed: "Closed",
};

function nameFor(names: Record<string, string>, id: string): string {
  return names[id] ?? `${id.slice(0, 8)}…`;
}

export default function ConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Pending-request count for the "New Requests" header link — fetched
  // alongside conversations so the badge is present without a second page
  // visit; not wired to real-time updates here (the nav dot already covers
  // "something needs attention" live — this count is a best-effort snapshot
  // as of page load, matching listPendingRequests()'s own polling-is-the-
  // fallback posture elsewhere in this surface).
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  // Bumped on every unread-row change so this component re-renders — see
  // messages/requests/page.tsx's identical pattern; the underlying state
  // lives in gatekept-notifications' plain module store, shared with the
  // nav dot and toast stack.
  const [, forceRerender] = useState(0);

  useEffect(() => {
    return subscribeUnreadRows(() => forceRerender((n) => n + 1));
  }, []);

  const load = useCallback(async () => {
    try {
      const { conversations } = await listConversations();
      setConversations(conversations);
      const participantIds = conversations.map((c) => c.otherParticipantId);
      if (participantIds.length > 0) {
        const resolved = await resolveUserNames(participantIds);
        setNames((prev) => ({ ...prev, ...resolved }));
      }
      // Best-effort count for the "New Requests" link — a failure here
      // shouldn't block the conversations list itself from rendering, so
      // it's caught separately rather than folded into the outer try/catch.
      listPendingRequests()
        .then(({ requests }) => setPendingCount(requests.length))
        .catch(() => setPendingCount(null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/");
      return;
    }
    void ensureRegistered().catch(() => {});
    load();
  }, [router, load]);

  if (loading) {
    return (
      <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center", paddingTop: "80px", color: "var(--fg-muted)" }}>
        <p style={{ fontSize: "14px" }}>Loading conversations…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Conversations</h1>
          <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>Your accepted message threads</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <Link
            href="/messages/requests"
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "8px 14px", fontSize: "13px", fontWeight: 600,
              background: "var(--surface)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: "999px",
              textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            New Requests
            {!!pendingCount && (
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                minWidth: "18px", height: "18px", padding: "0 5px",
                fontSize: "11px", fontWeight: 700, lineHeight: 1,
                borderRadius: "999px", background: "var(--accent)", color: "#fff",
              }}>
                {pendingCount}
              </span>
            )}
          </Link>
          <Link
            href="/messages/compose"
            aria-label="New message"
            title="New message"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "36px", height: "36px", flexShrink: 0,
              background: "var(--accent)", color: "#fff",
              border: "none", borderRadius: "999px", textDecoration: "none",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </Link>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div style={{ textAlign: "center", paddingTop: "60px", color: "var(--fg-muted)" }}>
          <p style={{ fontSize: "14px", fontWeight: 500 }}>No conversations yet</p>
          <p style={{ fontSize: "12px", marginTop: "6px", opacity: 0.6 }}>
            Accept a request from your{" "}
            <Link href="/messages/requests" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              inbox
            </Link>{" "}
            to start one
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {conversations.map((c) => {
            const unread = isConversationUnread(c.id);
            return (
            <Link
              key={c.id}
              href={`/messages/conversations/${c.id}`}
              onClick={() => clearUnreadConversation(c.id)}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "12px", padding: "14px 16px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "14px", textDecoration: "none",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
                <Avatar name={nameFor(names, c.otherParticipantId)} size={44} />
                <span style={{ fontSize: "14px", fontWeight: unread ? 700 : 600, color: "var(--fg)", display: "flex", alignItems: "center", gap: "6px" }}>
                  {unread && (
                    <span aria-label="Unread" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                  )}
                  {nameFor(names, c.otherParticipantId)}
                </span>
              </span>
              <span style={{
                fontSize: "12px", fontWeight: 600,
                color: c.status === "active" ? "var(--accent)" : "var(--fg-muted)",
              }}>
                {STATUS_LABEL[c.status]}
              </span>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
