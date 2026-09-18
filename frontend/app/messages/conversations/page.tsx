"use client";

// Conversation list — adapted from gatekept/web/app/conversations/page.tsx.
// The source showed only a raw "{c.otherParticipantId.slice(0, 8)}…"; this
// version batch-resolves every participant ID on the page to a real name via
// resolveUserNames(), falling back to an id fragment if a lookup misses.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listConversations, resolveUserNames, ensureRegistered, type ConversationSummary } from "@/lib/gatekept-api";
import { MessagesNavTabs } from "@/components/MessagesNavTabs";
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
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Conversations</h1>
        <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>Your accepted message threads</p>
      </div>

      <MessagesNavTabs />

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
              <span style={{ fontSize: "14px", fontWeight: unread ? 700 : 600, color: "var(--fg)", display: "flex", alignItems: "center", gap: "6px" }}>
                {unread && (
                  <span aria-label="Unread" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                )}
                {nameFor(names, c.otherParticipantId)}
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
