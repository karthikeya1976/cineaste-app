"use client";

// Requests inbox — adapted from gatekept/web/app/requests/page.tsx.
//
// The source only ever showed a raw truncated sender ID
// ("Sender ID: {req.senderId.slice(0, 8)}…"). This version batch-resolves
// every sender ID on the page to a real name via resolveUserNames() (one
// call for the whole list), falling back to a short id fragment for any id
// the lookup doesn't return rather than blocking or erroring the list.

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { OffensiveBanner } from "@/components/OffensiveBanner";
import { isLoggedIn } from "@/lib/auth";
import { isChatRequestUnread, clearUnreadChatRequest, subscribeUnreadRows } from "@/lib/gatekept-notifications";
import { getRequestDisplayMode, isConfirmedAbusive } from "@/lib/offensiveContent";

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
  // U7 (R9/KTD9): id of a request currently showing the inline "Accept
  // anyway?" confirmation step. Scoped to at most one row at a time (a
  // second Accept click on a different row simply swaps which row is
  // confirming) — this gate only ever applies to confirmed scanVerdict ===
  // "abusive" rows, not every banner-displaying row (see
  // lib/offensiveContent.ts's isConfirmedAbusive vs. getRequestDisplayMode
  // distinction).
  const [confirmingAcceptId, setConfirmingAcceptId] = useState<string | null>(null);
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

  // U7 (R9/KTD9): Accept's entry point from the row button. For a confirmed
  // scanVerdict === "abusive" row, the first click only opens the inline
  // "Accept anyway?" confirmation — it does NOT call the accept API. A
  // second click (the confirmation's own Accept button) calls
  // handleAccept() for real. For every other row (including banner rows
  // whose scanVerdict is merely missing/unrecognized rather than a
  // confirmed "abusive"), this is a direct one-tap call, unchanged from
  // before this unit.
  function onAcceptClick(req: ChatRequestSummary) {
    if (isConfirmedAbusive(req.scanVerdict) && confirmingAcceptId !== req.id) {
      setConfirmingAcceptId(req.id);
      return;
    }
    setConfirmingAcceptId(null);
    void handleAccept(req);
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
      {/* Back to the canonical conversations landing page — this surface
          has no rendered back-link JSX elsewhere to copy (the closest
          precedent, conversations/[conversationId]/page.tsx's block/report
          handlers, is a programmatic router.push inside an action handler,
          not a rendered link), so this is a small new element styled
          consistently with the app's existing link/icon conventions (see
          creators/[id]/page.tsx's own "Back" button for the same
          icon+label shape). */}
      <Link
        href="/messages/conversations"
        style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          background: "none", border: "none", cursor: "pointer",
          color: "var(--fg-muted)", fontSize: "13px", marginBottom: "20px",
          textDecoration: "none",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Conversations
      </Link>

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
            // U7 (R9/KTD9): fail-closed — banner shows unless scanVerdict is
            // exactly "clean" or "uncertain". See lib/offensiveContent.ts.
            const showBanner = getRequestDisplayMode(req.scanVerdict) === "banner";
            const isConfirmingAccept = confirmingAcceptId === req.id;
            return (
            <div key={req.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: unread ? 700 : 600, color: "var(--fg)", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                {unread && (
                  <span aria-label="Unread" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                )}
                {nameFor(names, req.senderId)}
              </p>
              {showBanner ? (
                <OffensiveBanner />
              ) : (
                <p style={{ fontSize: "14px", color: "var(--fg)", margin: 0 }}>{placeholderDecrypt(req.ciphertext)}</p>
              )}
              {isConfirmingAccept && (
                <div role="alert" style={{ padding: "10px 12px", borderRadius: "8px", background: "#7c2d1222", border: "1px solid #7c2d1255", fontSize: "13px", color: "var(--fg)", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span>This message was flagged as potentially abusive. Accept anyway?</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => onAcceptClick(req)} disabled={busyId === req.id} style={{ ...btnPrimary, opacity: busyId === req.id ? 0.6 : 1 }}>
                      Accept anyway
                    </button>
                    <button onClick={() => setConfirmingAcceptId(null)} disabled={busyId === req.id} style={{ ...btnSecondary, opacity: busyId === req.id ? 0.6 : 1 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {/* When the inline confirmation above is open, its own
                    "Accept anyway" button is the sole Accept affordance —
                    hiding this one avoids two differently-worded Accept
                    buttons on screen at once. Reject/Block/Report stay
                    rendered and one-tap regardless (per KTD9, only Accept
                    gets the extra step). */}
                {!isConfirmingAccept && (
                  <button onClick={() => onAcceptClick(req)} disabled={busyId === req.id} style={{ ...btnPrimary, opacity: busyId === req.id ? 0.6 : 1 }}>
                    Accept
                  </button>
                )}
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
