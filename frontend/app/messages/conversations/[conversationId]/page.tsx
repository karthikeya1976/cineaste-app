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
  presignAttachment,
  ApiError,
  type MessageSummary,
  type PresignAttachmentResponse,
} from "@/lib/gatekept-api";
import { getRealtimeClient, type RealtimeEvent } from "@/lib/gatekept-ws";
import { placeholderEncrypt, placeholderDecrypt } from "@/lib/gatekept-crypto";
import { CryptoNotice } from "@/components/CryptoNotice";
import {
  AttachmentPicker,
  type AttachmentState,
  type PendingAttachment,
} from "@/components/AttachmentPicker";
import { AttachmentMessage } from "@/components/AttachmentMessage";
import { Avatar } from "@/components/Avatar";
import { TypingIndicator } from "@/components/TypingIndicator";
import { uploadAttachment, isPresignExpired } from "@/lib/gatekept-attachments";
import { isLastInSenderRun } from "@/lib/messageRuns";
import { getUser, isLoggedIn } from "@/lib/auth";

// Avatar sizing/gap for the message-thread placement (issue #17 / U8):
// rendered next to the other participant's messages only, once per
// consecutive same-sender run, bottom-aligned with the run's last bubble.
// 32px matches the smallest existing inline avatar precedent already in
// this codebase (feed/page.tsx's comment-row avatars) — appropriate here
// since a thread bubble avatar sits inline next to dense message rows, not
// a list row like the 44px conversation-list avatar above it.
const THREAD_AVATAR_SIZE = 32;
const THREAD_AVATAR_GAP = "8px";

const POLL_INTERVAL_MS = 3000;

// issue #33 / U7 / plan docs/plans/2026-09-18-001-feat-seamless-chat-
// experience-plan.md, KTD5's own "named constants, not an approximate
// ~3s" requirement. TYPING_SEND_INTERVAL_MS: this client sends at most one
// sendTyping() call per this interval while the user is actively typing.
// TYPING_CLEAR_TIMEOUT_MS: the recipient auto-clears a received indicator
// after this much silence — deliberately longer than the send interval by
// a safe margin so the indicator cannot flicker off between two resends
// during a continuous typing burst.
const TYPING_SEND_INTERVAL_MS = 2000;
const TYPING_CLEAR_TIMEOUT_MS = 3500;

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
  // issue #26 / U6: the four named attachment states (see
  // components/AttachmentPicker.tsx's own header comment) — deliberately
  // NOT folded into `sending` above, since "uploading a file" and "posting
  // the message row" are distinct phases with their own failure modes
  // (an upload can fail and be retried without ever touching sendMessage).
  const [attachment, setAttachment] = useState<AttachmentState>({ kind: "idle" });
  // Remembers the most recent presign result + when it was issued, so
  // Retry can reuse the same presigned URL if still within its 15-minute
  // expiry (per the issue's explicit Retry behavior) instead of always
  // re-presigning.
  const lastPresign = useRef<{ result: PresignAttachmentResponse; issuedAtMs: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextMessageNumber = useRef(0);
  // issue #33 / U7: whether the other participant's typing indicator is
  // currently shown. State (not a ref), unlike this file's other
  // WS-bookkeeping fields, because it drives a render (whether
  // <TypingIndicator> is mounted at all) rather than being write-once
  // internal bookkeeping.
  const [otherIsTyping, setOtherIsTyping] = useState(false);
  // Last time (Date.now()) THIS client sent its own `typing` signal — a
  // simple "last sent at" check, not a full debounce library, per this
  // unit's own Approach ("don't over-engineer a full debounce library").
  const lastTypingSentAt = useRef(0);
  // Pending auto-clear timer for a RECEIVED typing indicator — reset on
  // every new `typing` event, fires after TYPING_CLEAR_TIMEOUT_MS of
  // silence, and is explicitly cleared (not just left to fire later) on
  // unmount/navigating away per this unit's own requirement.
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (event.type === "typing" && event.conversationId === conversationId) {
        // issue #33 / U7: record that the other participant just signaled
        // typing, show the indicator, and (re)start the auto-clear timer —
        // any previous pending timer is cleared first so a fresh signal
        // resets the clock rather than letting an earlier timer fire out
        // from under a still-typing sender.
        if (typingClearTimer.current) {
          clearTimeout(typingClearTimer.current);
        }
        setOtherIsTyping(true);
        typingClearTimer.current = setTimeout(() => {
          setOtherIsTyping(false);
          typingClearTimer.current = null;
        }, TYPING_CLEAR_TIMEOUT_MS);
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

      // issue #33 / U7: clear any locally-shown typing indicator and its
      // pending auto-clear timer IMMEDIATELY on unmount/navigating away —
      // not waiting for TYPING_CLEAR_TIMEOUT_MS to elapse on its own, per
      // this unit's own requirement.
      if (typingClearTimer.current) {
        clearTimeout(typingClearTimer.current);
        typingClearTimer.current = null;
      }
      setOtherIsTyping(false);
    };
  }, [conversationId, handleRealtimeEvent]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // issue #26 / U6, state (1) selected-unsent: purely local, sets state
  // and generates a local blob: preview URL — no network call of any kind.
  function handleAttachmentSelect(pending: PendingAttachment) {
    setAttachment({ kind: "selected", file: pending.file, previewUrl: pending.previewUrl });
  }

  // issue #26 / U6, state (4) rejected-before-upload — precheckAttachment
  // already ran (see AttachmentPicker's onSelect handler); this just
  // records the rejection for display. No network call.
  function handleAttachmentReject(filename: string, message: string) {
    setAttachment({ kind: "rejected", filename, message });
  }

  // issue #26 / U6: removing a selected-but-unsent (or rejected, or
  // failed) attachment. This is the exact path the acceptance criteria
  // requires never call presign — it only ever clears local state and
  // revokes the local object URL if one was created.
  function handleAttachmentRemove() {
    if ("previewUrl" in attachment && attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    lastPresign.current = null;
    setAttachment({ kind: "idle" });
  }

  /**
   * Runs the actual presign -> S3 PUT flow for the currently-selected
   * file, updating `attachment` state through uploading -> (selected once
   * done, ready for send) or -> failed on any error. Reused by both the
   * initial upload-on-send path and the Retry action.
   */
  async function runUpload(file: File, previewUrl: string | null): Promise<string | null> {
    setAttachment({ kind: "uploading", file, previewUrl, progress: 0 });
    try {
      let presign = lastPresign.current;
      const stillFresh =
        presign && presign.result.attachmentRef && !isPresignExpired(presign.issuedAtMs, presign.result.expiresInSeconds);
      if (!stillFresh) {
        const result = await presignAttachment(conversationId, file.name, file.type, file.size);
        presign = { result, issuedAtMs: Date.now() };
        lastPresign.current = presign;
      }

      await uploadAttachment(presign!.result.uploadUrl, file, (fraction) => {
        setAttachment({ kind: "uploading", file, previewUrl, progress: fraction });
      });

      return presign!.result.attachmentRef;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.";
      setAttachment({ kind: "failed", file, previewUrl, message });
      return null;
    }
  }

  // issue #26 / U6, state (3) upload-failed's Retry action: re-attempts
  // the same presigned URL if still within its 15-minute expiry
  // (lastPresign.current, checked inside runUpload via isPresignExpired),
  // otherwise transparently re-presigns — the caller (this function)
  // doesn't need to know which happened.
  async function handleAttachmentRetry() {
    if (attachment.kind !== "failed") return;
    await runUpload(attachment.file, attachment.previewUrl);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const hasAttachment = attachment.kind === "selected" || attachment.kind === "failed";
    if (!draft.trim() && !hasAttachment) return;
    // Never send while an upload the user hasn't retried/removed is still
    // actively failing or already sending a text-only message.
    if (attachment.kind === "uploading") return;

    setSending(true);
    setError("");

    try {
      let attachmentRef: string | undefined;

      if (hasAttachment) {
        const current = attachment as Extract<AttachmentState, { kind: "selected" | "failed" }>;
        const ref = await runUpload(current.file, current.previewUrl);
        if (!ref) {
          // runUpload already transitioned state to "failed" with a
          // message — stop here, don't post a message with no attachment
          // when the user clearly intended to send one.
          setSending(false);
          return;
        }
        attachmentRef = ref;
      }

      const encrypted = placeholderEncrypt(draft || " ");
      await sendMessage(conversationId, {
        ciphertext: encrypted.ciphertext,
        ciphertextType: encrypted.type,
        messageNumber: nextMessageNumber.current++,
        attachmentRef,
      });
      setDraft("");
      if (attachment.kind !== "idle" && attachment.kind !== "rejected") {
        if ("previewUrl" in attachment && attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      lastPresign.current = null;
      setAttachment({ kind: "idle" });
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
          messages.map((m, i) => {
            const mine = m.senderId === me?.id;
            // A single-space placeholder is sent for attachment-only
            // messages (see handleSend) so the placeholder-crypto layer
            // always has a non-empty payload — never rendered as visible
            // text alongside the attachment.
            const text = placeholderDecrypt(m.ciphertext);
            const showText = text.trim().length > 0;
            // Avatar placement (issue #17 / U8): only for the other
            // participant's messages, only once per consecutive
            // same-sender run, aligned to the LAST bubble in that run —
            // never once per message. isLastInSenderRun compares this
            // message's senderId to the next message's senderId (or
            // absence of a next message) to find the run boundary. Every
            // other-participant message that is NOT last-in-run still
            // reserves the avatar's width as a blank spacer (same size,
            // transparent) so bubble left edges stay aligned within the
            // run, rather than the avatar column collapsing and shifting
            // earlier-in-run bubbles left.
            const showAvatar = !mine && isLastInSenderRun(messages, i);
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                {!mine && (
                  <div style={{ width: `${THREAD_AVATAR_SIZE}px`, flexShrink: 0, marginRight: THREAD_AVATAR_GAP, alignSelf: "flex-end" }}>
                    {showAvatar && <Avatar name={otherName ?? "?"} size={THREAD_AVATAR_SIZE} />}
                  </div>
                )}
                <div style={{
                  maxWidth: "75%", borderRadius: "10px", padding: "8px 12px", fontSize: "14px",
                  background: mine ? "var(--accent)" : "var(--bg)",
                  color: mine ? "#fff" : "var(--fg)",
                  border: mine ? "none" : "1px solid var(--border)",
                  display: "flex", flexDirection: "column", gap: "6px",
                }}>
                  {m.attachmentRef && (
                    <AttachmentMessage conversationId={conversationId} attachmentRef={m.attachmentRef} />
                  )}
                  {showText && <span>{text}</span>}
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

      {attachment.kind !== "idle" && (
        <div style={{ marginTop: "12px" }}>
          <AttachmentPicker
            state={attachment}
            onSelect={handleAttachmentSelect}
            onReject={handleAttachmentReject}
            onRemove={handleAttachmentRemove}
            onRetry={handleAttachmentRetry}
            disabled={sending}
          />
        </div>
      )}

      {/* issue #33 / U7: rendered as its own row BETWEEN the scrollable
          message list above and the compose input form below — outside the
          scrollRef-managed scroll container, so it never triggers that
          container's auto-scroll effect (which fires only on `messages`
          changes) and never causes layout shift inside the message list
          itself. Renders nothing when there's nothing to announce (see
          TypingIndicator's own doc comment), so this row reserves no
          visual space while idle. */}
      {otherIsTyping && <TypingIndicator name={otherName ?? "They"} />}

      <form onSubmit={handleSend} style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
        {attachment.kind === "idle" && (
          <AttachmentPicker
            state={attachment}
            onSelect={handleAttachmentSelect}
            onReject={handleAttachmentReject}
            onRemove={handleAttachmentRemove}
            onRetry={handleAttachmentRetry}
            disabled={sending}
          />
        )}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // issue #33 / U7: send at most one sendTyping() call per
            // TYPING_SEND_INTERVAL_MS while the user is actively typing — a
            // simple "last sent at" ref check, not a full debounce library
            // (per this unit's own Approach).
            const now = Date.now();
            if (now - lastTypingSentAt.current >= TYPING_SEND_INTERVAL_MS) {
              lastTypingSentAt.current = now;
              getRealtimeClient().sendTyping(conversationId);
            }
          }}
          placeholder="Type a message…"
          style={{
            flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "8px", padding: "10px 12px", fontSize: "14px",
            color: "var(--fg)", outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={
            sending ||
            attachment.kind === "uploading" ||
            (!draft.trim() && attachment.kind !== "selected" && attachment.kind !== "failed")
          }
          style={{
            padding: "10px 18px", fontSize: "14px", fontWeight: 600,
            background: "var(--accent)", color: "#fff", border: "none",
            borderRadius: "8px", cursor: "pointer",
            opacity:
              sending ||
              attachment.kind === "uploading" ||
              (!draft.trim() && attachment.kind !== "selected" && attachment.kind !== "failed")
                ? 0.6
                : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
