"use client";

// Conversation view — adapted from gatekept/web/app/conversations/[id]/page.tsx.
// The source header just said "Conversation"; this version resolves and
// shows the other participant's real name via resolveUserNames() (one call,
// for this conversation's single other participant), falling back to an id
// fragment if the lookup misses.

import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getMessages,
  sendMessage,
  blockUser,
  fileReport,
  resolveUserNames,
  ApiError,
  type MessageSummary,
} from "@/lib/gatekept-api";
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

  const load = useCallback(async () => {
    try {
      const { messages } = await getMessages(conversationId, -1);
      setMessages(messages);
      nextMessageNumber.current = messages.length
        ? Math.max(...messages.map((m) => m.messageNumber)) + 1
        : 0;

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

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/");
      return;
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router, load]);

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
