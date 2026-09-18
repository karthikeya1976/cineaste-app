"use client";

// Transient toast stack for real-time notifications — issue #10 (frontend)
// / U3 / plan's Notification UI subsection, toast state #2.
//
// Copy (verbatim from the plan, not paraphrased): "New message from {name}"
// for an in-conversation message, "{name} wants to message you" for a new
// chat request — NEVER a content preview, matching CryptoNotice's existing
// transparency commitment (this app's placeholder-crypto disclosure already
// commits to not treating content as confidential-but-displayed, and a
// preview would need to survive being wrong the instant a block/report
// changes the conversation's state — see the plan's own reasoning). The
// badge event payload itself never carries message content (only ids — see
// gatekept-ws.ts / realtimeDelivery.ts), so there is nothing here to
// accidentally leak even by mistake.
//
// STYLING: card matching the existing var(--surface)/var(--border)/12-14px
// radius pattern already used throughout messages/*.tsx (not a
// shadow-heavy floating notification, per the plan's explicit steer away
// from that) — avatar rendered via the shared <Avatar> component (issue
// #17 / U8), which extracts the exact u.name.charAt(0).toUpperCase()
// circle pattern messages/page.tsx originally established for search
// results; this file's own copy of that pattern was the first migration
// target per KTD7.
//
// BEHAVIOR: auto-dismisses after 5 seconds or on click; click navigates to
// the relevant conversation or requests inbox. Multiple simultaneous
// toasts stack, most recent on top (rendered first, given this stack is
// positioned top-right — see the container's flex-direction below).
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { resolveUserNames } from "@/lib/gatekept-api";
import { subscribeNotifications, type NotificationEvent } from "@/lib/gatekept-notifications";
import { Avatar } from "@/components/Avatar";

const AUTO_DISMISS_MS = 5000;

interface ToastItem {
  id: string;
  reason: NotificationEvent["reason"];
  name: string;
  conversationId?: string;
  chatRequestId?: string;
}

function copyFor(reason: NotificationEvent["reason"], name: string): string {
  return reason === "chat_request" ? `${name} wants to message you` : `New message from ${name}`;
}

let toastCounter = 0;
function nextToastId(): string {
  toastCounter += 1;
  return `toast-${toastCounter}-${Date.now()}`;
}

export default function MessageToast() {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    // Captured once per effect run — timersRef.current is a plain mutable
    // Map (mutated in place, never reassigned), so this snapshot and
    // `timersRef.current` always refer to the identical Map object for the
    // lifetime of this effect. Captured as a local purely to satisfy
    // react-hooks/exhaustive-deps' generic "ref value may have changed by
    // cleanup time" warning, which assumes .current could be reassigned
    // out from under the closure (true for DOM node refs, not for this
    // plain data ref).
    const timers = timersRef.current;
    const unsubscribe = subscribeNotifications((event) => {
      void (async () => {
        // Resolve a display name for the person this event is about.
        // resolveUserNames() falls back to leaving the id out of its
        // result map on a miss (see gatekept-api.ts's own doc comment) —
        // this toast falls back to a short id fragment in that case,
        // matching the same convention messages/requests and
        // messages/conversations pages already use (nameFor()).
        const id = event.senderId;
        let name = "Someone";
        if (id) {
          try {
            const resolved = await resolveUserNames([id]);
            name = resolved[id] ?? `${id.slice(0, 8)}…`;
          } catch {
            name = `${id.slice(0, 8)}…`;
          }
        }

        const toastId = nextToastId();
        const item: ToastItem = {
          id: toastId,
          reason: event.reason,
          name,
          conversationId: event.conversationId,
          chatRequestId: event.chatRequestId,
        };

        // Most recent on top: prepend rather than append, paired with the
        // container rendering top-to-bottom below.
        setToasts((prev) => [item, ...prev]);

        const timer = setTimeout(() => dismiss(toastId), AUTO_DISMISS_MS);
        timersRef.current.set(toastId, timer);
      })();
    });

    return () => {
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [dismiss]);

  function handleClick(toast: ToastItem) {
    dismiss(toast.id);
    if (toast.reason === "chat_request") {
      router.push("/messages/requests");
    } else {
      router.push(toast.conversationId ? `/messages/conversations/${toast.conversationId}` : "/messages/conversations");
    }
  }

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        maxWidth: "340px",
        width: "calc(100vw - 32px)",
      }}
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => handleClick(toast)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            textAlign: "left",
            width: "100%",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "12px 14px",
            cursor: "pointer",
            color: "var(--fg)",
          }}
        >
          <Avatar name={toast.name} size={36} />
          <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--fg)", margin: 0 }}>
            {copyFor(toast.reason, toast.name)}
          </p>
        </button>
      ))}
    </div>
  );
}
