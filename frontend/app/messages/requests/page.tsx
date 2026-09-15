"use client";

// Requests inbox — adapted from gatekept/web/app/requests/page.tsx.
//
// The source only ever showed a raw truncated sender ID
// ("Sender ID: {req.senderId.slice(0, 8)}…"). This version batch-resolves
// every sender ID on the page to a real name via resolveUserNames() (one
// call for the whole list), falling back to a short id fragment for any id
// the lookup doesn't return rather than blocking or erroring the list.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listPendingRequests,
  acceptChatRequest,
  rejectChatRequest,
  blockUser,
  fileReport,
  resolveUserNames,
  ensureRegistered,
  ApiError,
  type ChatRequestSummary,
} from "@/lib/gatekept-api";
import { placeholderDecrypt } from "@/lib/gatekept-crypto";
import { CryptoNotice } from "@/components/CryptoNotice";
import { isLoggedIn } from "@/lib/auth";
import { isChatRequestUnread, clearUnreadChatRequest, subscribeUnreadRows } from "@/lib/gatekept-notifications";

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", fontSize: "13px", fontWeight: 600,
  background: "var(--accent)", color: "#fff", border: "none",
  borderRadius: "8px", cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 14px", fontSize: "13px", fontWeight: 500,
  background: "transparent", color: "var(--fg-muted)",
  border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "8px 14px", fontSize: "13px", fontWeight: 600,
  background: "transparent", color: "#f87171",
  border: "1px solid #7f1d1d55", borderRadius: "8px", cursor: "pointer",
};

function nameFor(names: Record<string, string>, id: string): string {
  return names[id] ?? `${id.slice(0, 8)}…`;
}

export default function RequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ChatRequestSummary[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Bumped on every unread-row change so this component re-renders — the
  // underlying unread state lives in gatekept-notifications' plain module
  // store (shared with the nav dot and toast stack), not React state.
  const [, forceRerender] = useState(0);

  useEffect(() => {
    return subscribeUnreadRows(() => forceRerender((n) => n + 1));
  }, []);

  // Mount-time fetch runs as a promise chain rather than an async function
  // invoked by reference — matches app/feed/page.tsx's CommentDrawer
  // pattern, which keeps the effect body itself synchronous (react-hooks'
  // set-state-in-effect rule flags a synchronously-called async function
  // that sets state, even though the actual setState calls only happen
  // after an internal await).
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/");
      return;
    }
    // Accepting a request creates a conversation row FK-referencing this
    // user's own Gatekept row — must exist before Accept can succeed. See
    // lib/gatekept-api.ts's ensureRegistered() for the full story.
    void ensureRegistered().catch(() => {});
    listPendingRequests()
      .then(({ requests }) => {
        setRequests(requests);
        // One batch call for every sender on the page, not one lookup per row.
        const senderIds = requests.map((r) => r.senderId);
        if (senderIds.length === 0) return;
        return resolveUserNames(senderIds).then((resolved) => {
          setNames((prev) => ({ ...prev, ...resolved }));
        });
      })
      .catch(() => setError("Could not load requests."))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleAccept(req: ChatRequestSummary) {
    setBusyId(req.id);
    // Opening/acting on this row clears its unread state — see the plan's
    // Notification UI subsection: "Clears for that row the moment the user
    // opens it."
    clearUnreadChatRequest(req.id);
    try {
      const { conversationId } = await acceptChatRequest(req.id);
      router.push(`/messages/conversations/${conversationId}`);
    } catch {
      setError("Could not accept that request.");
      setBusyId(null);
    }
  }

  async function handleReject(req: ChatRequestSummary) {
    setBusyId(req.id);
    clearUnreadChatRequest(req.id);
    try {
      await rejectChatRequest(req.id);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch {
      setError("Could not dismiss that request.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBlock(req: ChatRequestSummary) {
    setBusyId(req.id);
    clearUnreadChatRequest(req.id);
    try {
      await blockUser(req.senderId, "pre_accept");
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch {
      setError("Could not block that sender.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReport(req: ChatRequestSummary) {
    setBusyId(req.id);
    clearUnreadChatRequest(req.id);
    try {
      // Pre-acceptance report — the platform already has the ciphertext and
      // its own scan verdict on file for this chat_request, so no evidence
      // submission is needed here.
      await fileReport({ reportedUserId: req.senderId, category: "harassment", chatRequestId: req.id });
      await blockUser(req.senderId, "pre_accept");
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file that report.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center", paddingTop: "80px", color: "var(--fg-muted)" }}>
        <p style={{ fontSize: "14px" }}>Loading requests…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Message requests</h1>
        <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>
          People who&apos;ve sent you a first message. Accepting opens a two-way conversation.
        </p>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <CryptoNotice />
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#7f1d1d22", border: "1px solid #7f1d1d55", fontSize: "13px", color: "#f87171", marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {requests.length === 0 ? (
        <div style={{ textAlign: "center", paddingTop: "60px", color: "var(--fg-muted)" }}>
          <p style={{ fontSize: "14px", fontWeight: 500 }}>No pending requests</p>
          <p style={{ fontSize: "12px", marginTop: "6px", opacity: 0.6 }}>
            New message requests from other members will show up here
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {requests.map((req) => {
            const unread = isChatRequestUnread(req.id);
            return (
            <div key={req.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: unread ? 700 : 600, color: "var(--fg)", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                {unread && (
                  <span aria-label="Unread" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                )}
                {nameFor(names, req.senderId)}
              </p>
              <p style={{ fontSize: "14px", color: "var(--fg)", margin: 0 }}>{placeholderDecrypt(req.ciphertext)}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button onClick={() => handleAccept(req)} disabled={busyId === req.id} style={{ ...btnPrimary, opacity: busyId === req.id ? 0.6 : 1 }}>
                  Accept
                </button>
                <button onClick={() => handleReject(req)} disabled={busyId === req.id} style={{ ...btnSecondary, opacity: busyId === req.id ? 0.6 : 1 }}>
                  Dismiss
                </button>
                <button onClick={() => handleBlock(req)} disabled={busyId === req.id} style={{ ...btnSecondary, opacity: busyId === req.id ? 0.6 : 1 }}>
                  Block
                </button>
                <button onClick={() => handleReport(req)} disabled={busyId === req.id} style={{ ...btnDanger, opacity: busyId === req.id ? 0.6 : 1 }}>
                  Report &amp; block
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
