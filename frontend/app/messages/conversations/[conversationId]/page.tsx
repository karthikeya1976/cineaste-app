"use client";

// Conversation view — adapted from gatekept/web/app/conversations/[id]/page.tsx.
// The source header just said "Conversation"; this version resolves and
// shows the other participant's real name via resolveUserNames() (one call,
// for this conversation's single other participant), falling back to an id
// fragment if the lookup misses.
//
// LIVE DELIVERY + RESUME, WITH POLLING KEPT AS AN EXPLICIT FALLBACK (issue
// #22 / U4): this page wires in the shared WS client (gatekept-ws.ts) for
// live message delivery and KTD6 resume-on-reconnect, but the pre-existing
// `POLL_INTERVAL_MS` setInterval below is deliberately NOT removed — it
// keeps running unconditionally for the lifetime of this page, regardless
// of whether the WS connection ever establishes. This is additive, not an
// either/or rewrite: the WS path makes new messages appear immediately
// (via onEvent) and lets a brief disconnect catch up via resume() instead
// of waiting out a poll interval, but if the WS connection never
// establishes at all (blocked proxy, corporate firewall) or a
// resume_fallback signal arrives for this conversation, the existing
// polling loop is what keeps the thread correct — it was never turned off
// to begin with, so there is no separate "switch to polling" code path to
// get wrong.
import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getMessages,
  sendMessage,
  blockUser,
  fileReport,
  resolveUserNames,
  ensureRegistered,
  ApiError,
  type MessageSummary,
} from "@/lib/gatekept-api";
import { getRealtimeClient, type RealtimeEvent } from "@/lib/gatekept-ws";
import { placeholderEncrypt, placeholderDecrypt } from "@/lib/gatekept-crypto";
import { CryptoNotice } from "@/components/CryptoNotice";
import { getUser, isLoggedIn } from "@/lib/auth";

const POLL_INTERVAL_MS = 3000;

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", fontSize: "12px", fontWeight: 500,
  background: "transparent", color: "var(--fg-muted)",
  border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "6px 12px", fontSize: "12px", fontWeight: 600,
  background: "transparent", color: "#f87171",
  border: "1px solid #7f1d1d55", borderRadius: "8px", cursor: "pointer",
};

export default function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [otherName, setOtherName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextMessageNumber = useRef(0);

  const me = getUser();

  // Highest server-reported message_number this page has rendered, for THIS
  // conversation. Doubles as the resume cursor `setLastSeen()`/`resume()`
  // report to the WS layer (KTD6) — the polling loop's own getMessages
  // response is what actually keeps it correct, so it stays right even if
  // the WS connection never establishes at all.
  const lastSeenMessageNumber = useRef(-1);

  const load = useCallback(async () => {
    try {
      const { messages } = await getMessages(conversationId, -1);
      setMessages(messages);
      nextMessageNumber.current = messages.length
        ? Math.max(...messages.map((m) => m.messageNumber)) + 1
        : 0;
      if (messages.length > 0) {
        const maxSeen = Math.max(...messages.map((m) => m.messageNumber));
        if (maxSeen > lastSeenMessageNumber.current) {
          lastSeenMessageNumber.current = maxSeen;
        }
        getRealtimeClient().setLastSeen(conversationId, lastSeenMessageNumber.current);
      }

      // Resolve the other participant's name once we know who they are —
      // one lookup call for this conversation's single other participant.
      const other = messages.find((m) => m.senderId !== me?.id)?.senderId;
      if (other) {
        const resolved = await resolveUserNames([other]);
        setOtherName(resolved[other] ?? `${other.slice(0, 8)}…`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("This conversation is no longer active.");
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId, me?.id]);

  /**
   * Merges a single live/replayed full-message event into `messages`
   * without waiting for the next poll — this is what makes a message sent
   * during a brief disconnect (or simply while connected) appear
   * immediately instead of up to POLL_INTERVAL_MS later. Deliberately
   * dedupes by messageNumber (not id, which this event shape doesn't even
   * carry — see FullMessageEvent) since the next poll's getMessages() call
   * will eventually supply the authoritative row anyway; this is a
   * best-effort optimistic placeholder, not a replacement for load().
   * A WS-sourced row with no local content to render (ciphertext, sentAt)
   * is intentionally NOT synthesized here — decrypting/rendering it
   * correctly still requires the real row, which the very next poll
   * fetches. This handler's only job is nudging load() to run right away
   * instead of waiting for the interval, which is both simpler and avoids
   * ever rendering a fabricated MessageSummary shape.
   */
  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === "message" && event.conversationId === conversationId) {
        if (event.messageNumber > lastSeenMessageNumber.current) {
          void load();
        }
        return;
      }
      if (event.type === "resume_fallback" && event.conversationIds.includes(conversationId)) {
        // KTD6 fallback: this conversation's gap was too large, or the
        // disconnect was too long, for a direct replay. The polling
        // setInterval (never removed — see this file's header comment)
        // already covers this on its own next tick; triggering an
        // immediate load() here just avoids waiting out the rest of the
        // current poll interval.
        void load();
      }
    },
    [conversationId, load]
  );

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/");
      return;
    }
    // The initial call is deferred behind a resolved-promise `.then()`
    // rather than invoked directly, so the effect body itself stays
    // synchronous (react-hooks' set-state-in-effect rule flags a
    // synchronously-called function that sets state, even one that only
    // actually sets state after an internal await) — see
    // app/feed/page.tsx's CommentDrawer for the same pattern. The
    // interval's own callback invocations are unaffected either way,
    // since they run later, not synchronously within this effect.
    //
    // THE POLLING FALLBACK: this setInterval is the pre-existing
    // implementation and is deliberately kept exactly as-is, unconditional
    // on WS state — see this file's header comment. It is what the
    // acceptance criteria call "the conversation view keeps working,
    // degraded to polling latency, not broken" whenever the WS layer below
    // isn't available for any reason.
    void ensureRegistered().catch(() => {});
    Promise.resolve().then(load);
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router, load]);

  // WS wiring: live delivery + KTD6 resume, purely additive to the polling
  // loop above. Uses the same app-wide singleton NavBar already connects
  // (gatekept-ws.ts's own header comment on why one shared connection per
  // tab is intended) — this effect does not call disconnect() on cleanup,
  // only enterConversation(null)-equivalent (leaveConversation) and its own
  // listener unsubscribes, since other mounted consumers (NavBar) still
  // want the connection alive.
  useEffect(() => {
    if (!isLoggedIn()) return;

    const client = getRealtimeClient();
    let cancelled = false;

    void client
      .connect()
      .then(() => {
        if (cancelled) return;
        client.enterConversation(conversationId);
        // Catch anything that arrived between this page's initial
        // getMessages() call and the socket finishing its handshake —
        // resume() is a no-op if lastSeenMessageNumber hasn't been
        // populated yet (load() hasn't resolved), which is fine: the
        // initial load() call already covers that case on its own.
        if (lastSeenMessageNumber.current >= 0) {
          client.resume([{ id: conversationId, lastSeenMessageNumber: lastSeenMessageNumber.current }]);
        }
      })
      .catch(() => {
        // Best-effort — see this file's header comment. The polling loop
        // above is completely unaffected by a failed WS connection.
      });

    const unsubscribeEvent = client.onEvent(handleRealtimeEvent);

    return () => {
      cancelled = true;
      unsubscribeEvent();
      client.leaveConversation();
      client.setLastSeen(conversationId, null);
      // Deliberately does NOT call client.disconnect() — see comment above.
    };
  }, [conversationId, handleRealtimeEvent]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError("");

    try {
      const encrypted = placeholderEncrypt(draft);
      await sendMessage(conversationId, {
        ciphertext: encrypted.ciphertext,
        ciphertextType: encrypted.type,
        messageNumber: nextMessageNumber.current++,
      });
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  async function handleBlock() {
    const other = messages.find((m) => m.senderId !== me?.id)?.senderId;
    if (!other) return;
    await blockUser(other, "post_accept");
    router.push("/messages/conversations");
  }

  async function handleReport() {
    const other = messages.find((m) => m.senderId !== me?.id)?.senderId;
    if (!other) return;
    // Post-acceptance report: the platform never saw this content, so the
    // reporter's own decrypted messages are submitted as voluntary evidence.
    const excerpt = messages
      .filter((m) => m.senderId === other)
      .map((m) => placeholderDecrypt(m.ciphertext))
      .join("\n");
    await fileReport({
      reportedUserId: other,
      category: "harassment",
      conversationId,
      evidence: { plaintextExcerpt: excerpt },
    });
    await blockUser(other, "post_accept");
    router.push("/messages/conversations");
  }

  if (loading) {
    return (
      <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center", paddingTop: "80px", color: "var(--fg-muted)" }}>
        <p style={{ fontSize: "14px" }}>Loading conversation…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", display: "flex", flexDirection: "column", height: "calc(100vh - 140px)" }}>
      <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--fg)", margin: 0 }}>
          {otherName ?? "Conversation"}
        </h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={handleBlock} style={btnSecondary}>Block</button>
          <button onClick={handleReport} style={btnDanger}>Report &amp; block</button>
        </div>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <CryptoNotice compact />
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ textAlign: "center", fontSize: "13px", color: "var(--fg-muted)", margin: "auto" }}>
            No messages yet — say hello.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === me?.id;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "75%", borderRadius: "10px", padding: "8px 12px", fontSize: "14px",
                  background: mine ? "var(--accent)" : "var(--bg)",
                  color: mine ? "#fff" : "var(--fg)",
                  border: mine ? "none" : "1px solid var(--border)",
                }}>
                  {placeholderDecrypt(m.ciphertext)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p style={{ marginTop: "8px", fontSize: "13px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "10px 12px" }}>
          {error}
        </p>
      )}

      <form onSubmit={handleSend} style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          style={{
            flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "8px", padding: "10px 12px", fontSize: "14px",
            color: "var(--fg)", outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          style={{
            padding: "10px 18px", fontSize: "14px", fontWeight: 600,
            background: "var(--accent)", color: "#fff", border: "none",
            borderRadius: "8px", cursor: "pointer",
            opacity: sending || !draft.trim() ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
