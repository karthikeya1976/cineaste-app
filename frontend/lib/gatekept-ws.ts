// Thin WebSocket client wrapper for Gatekept's real-time channel — issue #10
// (frontend) / U3 / plan section "Server-side delivery to connected sockets".
//
// PROTOCOL (see gatekept/backend/src/services/realtimeServer.ts and
// realtimeDelivery.ts, both U1/U3, for the authoritative server-side
// implementation this mirrors):
//   1. POST /api/gatekept/v1/realtime/ticket (Bearer auth) -> { ticket, expiresInSeconds }
//   2. Open a WebSocket to .../v1/realtime/connect?ticket=<ticket>
//   3. Server sends { type: "connected", socketId } once registered
//   4. Client may send { type: "enter_conversation", conversationId } or
//      { type: "leave_conversation" } — server acks entry with
//      { type: "enter_conversation_result", entered: boolean }
//   5. Server pushes either a full message event
//      { type: "message", conversationId, messageNumber, senderId } (only
//      to a socket that has entered that exact conversation) or a
//      lightweight badge event
//      { type: "badge", reason: "message" | "chat_request", conversationId?,
//        chatRequestId?, senderId? } to every other socket for the
//      recipient — see realtimeDelivery.ts's own header comment for the
//      full suppression rule this client is the other half of.
//
// WHY NOT THROUGH next.config.ts's /api/gatekept REWRITE: Next.js's
// `rewrites()` proxies plain HTTP requests; it does not reliably proxy a
// WebSocket Upgrade handshake (Vercel's own routing layer does not forward
// the Upgrade header through a rewrite the way a real reverse proxy would).
// The ticket-issuance POST above still goes through the existing
// /api/gatekept proxy (same-origin, ordinary HTTP, no issue there) — only
// the WebSocket connection itself is opened directly against the Gatekept
// backend's own host, mirroring next.config.ts's GATEKEPT_BACKEND constant
// by hand (that constant is evaluated at build/server time via
// process.env.VERCEL, which does not exist in the browser bundle — see
// wsBaseUrl() below for the client-side equivalent, keyed off
// window.location.hostname instead).
//
// RECONNECT/RESUME (issue #22 / U4 / plan KTD6): on an unexpected socket
// close, this client attempts a bounded number of reconnects with
// increasing backoff (see RECONNECT_DELAYS_MS below); each successful
// reconnect automatically sends `{ type: "resume", conversations: [...] }`
// for whatever conversations a caller has registered interest in via
// `setLastSeen()`. The server (gatekept/backend/src/services/
// realtimeResume.ts) replies per-conversation with either replayed
// `FullMessageEvent`s (each carrying `replayed: true`, still dispatched
// through the same `onEvent` mechanism as a live delivery so a consumer
// doesn't need two code paths) or a single `ResumeFallbackEvent` listing
// conversations whose gap was too large or whose disconnect was too long
// ago — a consumer that cares about a specific conversation's fallback
// should check `event.conversationIds.includes(conversationId)` on that
// event, mirroring how a full message event is filtered by
// `conversationId` today.
//
// An explicit `disconnect()` call does NOT trigger a reconnect attempt —
// only an unrequested close (network drop, server-side eviction/ban, or
// the resume itself failing) does. This mirrors browser reconnect
// conventions (e.g. native EventSource) where a caller-initiated close is
// never treated as something to recover from.
import { getToken } from "./auth";

export type FullMessageEvent = {
  type: "message";
  conversationId: string;
  messageNumber: number;
  senderId: string;
  // Present (and true) only on a row delivered via resume replay, never on
  // a live U3 delivery — lets a consumer that cares (e.g. to skip a
  // "new message" sound/toast for backlog) distinguish the two without a
  // separate event type, while a consumer that doesn't care can treat both
  // uniformly (the field is simply absent on a live delivery).
  replayed?: true;
};

export type BadgeEvent = {
  type: "badge";
  reason: "chat_request" | "message";
  chatRequestId?: string;
  conversationId?: string;
  senderId?: string;
};

export type ResumeFallbackEvent = {
  type: "resume_fallback";
  conversationIds: string[];
};

// issue #33 / U7 / plan docs/plans/2026-09-18-001-feat-seamless-chat-
// experience-plan.md, KTD5: an ephemeral "the other participant is actively
// typing" push, never persisted server-side and never replayed via resume
// (KTD5 — a client that reconnects mid-typing simply stops sending the
// signal and the recipient's indicator times out client-side instead).
export type TypingEvent = {
  type: "typing";
  conversationId: string;
  senderId: string;
};

// issue #20 / U4 / plan docs/plans/2026-09-18-001-feat-seamless-chat-
// experience-plan.md: pushed when the server has confirmed a message this
// client sent has been delivered or read by the other participant (see
// gatekept/backend/src/services/messageStatus.ts, U2/U3). Only ever
// received for messages the current user SENT — the server never sends
// this for a message the recipient itself received.
export type StatusEvent = {
  type: "status";
  conversationId: string;
  messageNumber: number;
  state: "delivered" | "read";
};

export type RealtimeEvent =
  | FullMessageEvent
  | BadgeEvent
  | ResumeFallbackEvent
  | TypingEvent
  | StatusEvent;

type EventListener = (event: RealtimeEvent) => void;
type ConnectionListener = () => void;

// KTD6: a handful of bounded retries with increasing delay, not infinite —
// a genuinely offline client (or a proxy that blocks WS upgrades outright)
// must eventually stop retrying and leave the decision to fall back to
// polling to the caller (see the conversation page's own WS+polling
// wiring), rather than this module retrying forever in the background.
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 15000];

const TICKET_PATH = "/api/gatekept/v1/realtime/ticket";
const CONNECT_PATH = "/v1/realtime/connect";

// The same production host next.config.ts's GATEKEPT_BACKEND constant
// hardcodes for Vercel. Duplicated here (not imported) because
// next.config.ts's module runs in the Node build/server context and isn't
// importable into client bundle code — see this file's header comment.
const PRODUCTION_GATEKEPT_HOST = "redactor-api.duckdns.org";
const PRODUCTION_GATEKEPT_WS_PATH = "/gatekept";

function isLocalDev(): boolean {
  if (typeof window === "undefined") return true;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

/**
 * Builds the WebSocket URL to connect to, mirroring next.config.ts's
 * GATEKEPT_BACKEND prod/local split: wss:// against the shared production
 * host (Nginx there strips the /gatekept prefix, per next.config.ts's own
 * comment) locally ws:// straight to Gatekept's dev port (4000, no prefix,
 * no Nginx in front).
 */
export function realtimeWsUrl(ticket: string): string {
  if (isLocalDev()) {
    return `ws://localhost:4000${CONNECT_PATH}?ticket=${encodeURIComponent(ticket)}`;
  }
  return `wss://${PRODUCTION_GATEKEPT_HOST}${PRODUCTION_GATEKEPT_WS_PATH}${CONNECT_PATH}?ticket=${encodeURIComponent(ticket)}`;
}

async function fetchTicket(): Promise<string> {
  const token = getToken();
  const res = await fetch(TICKET_PATH, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Failed to obtain realtime ticket (status ${res.status})`);
  }
  const body = (await res.json()) as { ticket: string };
  return body.ticket;
}

function parseIncoming(raw: string): RealtimeEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) return null;
    const type = (parsed as { type: unknown }).type;
    if (
      type === "message" ||
      type === "badge" ||
      type === "resume_fallback" ||
      type === "typing" ||
      type === "status"
    ) {
      return parsed as RealtimeEvent;
    }
    // Other server message types (`connected`, `enter_conversation_result`)
    // are handled internally by connect()/enterConversation() below, not
    // surfaced to RealtimeEvent subscribers.
    return null;
  } catch {
    return null;
  }
}

/**
 * A single Gatekept realtime connection. One instance is meant to be
 * shared app-wide (see the singleton export below) — a fresh instance per
 * consumer would mean each opens its own ticket + socket, defeating the
 * per-tab-one-socket assumption the rest of the protocol (KTD5's per-tab
 * ticket fetch) is built around at the intra-tab level.
 */
export class GatekeptRealtimeClient {
  private socket: WebSocket | null = null;
  private eventListeners = new Set<EventListener>();
  private disconnectListeners = new Set<ConnectionListener>();
  private connectPromise: Promise<void> | null = null;

  // KTD6: per-conversation last-seen cursor this client has registered
  // interest in, keyed by conversationId. This wrapper doesn't track
  // message history itself (callers already know their own last-rendered
  // messageNumber) — this map exists purely so an automatic post-reconnect
  // resume() has something to send without the caller needing to re-supply
  // it after every reconnect. Survives across reconnects (cleared only by
  // an explicit `disconnect()` call, matching "a caller-requested
  // disconnect means I'm done with this session" semantics).
  private lastSeen = new Map<string, number>();

  // Reconnect bookkeeping. `reconnectAttempts` resets to 0 on every
  // successful (resolved) connect — only a *post-initial* unrequested close
  // increments it and consults RECONNECT_DELAYS_MS.
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitDisconnect = false;

  /**
   * Fetches a ticket and opens the WebSocket connection. Idempotent while
   * already connecting/connected — a second call reuses the in-flight or
   * established connection rather than opening a duplicate socket.
   */
  connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return this.connectPromise ?? Promise.resolve();
    }

    this.explicitDisconnect = false;
    this.connectPromise = this.openSocket();
    return this.connectPromise;
  }

  private async openSocket(): Promise<void> {
    const ticket = await fetchTicket();
    const url = realtimeWsUrl(ticket);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;

      ws.onmessage = (ev) => {
        let data: unknown;
        try {
          data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        if (typeof data !== "object" || data === null || !("type" in data)) return;

        if ((data as { type: unknown }).type === "connected") {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        const event = parseIncoming(typeof ev.data === "string" ? ev.data : "");
        if (event) {
          for (const listener of this.eventListeners) listener(event);
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("Realtime connection failed"));
        }
      };

      ws.onclose = () => {
        this.socket = null;
        for (const listener of this.disconnectListeners) listener();
        if (!settled) {
          settled = true;
          reject(new Error("Realtime connection closed before it was established"));
        }
        this.scheduleReconnect();
      };

      this.socket = ws;
    });

    // Reaching here means the 'connected' ack arrived — a genuine
    // successful (re)connection, not just a constructed socket. Reset the
    // backoff counter and, if this was a reconnect (not the very first
    // connect of this client's lifetime), immediately resume whatever
    // conversations the caller has registered.
    const isReconnect = this.reconnectAttempts > 0;
    this.reconnectAttempts = 0;
    if (isReconnect && this.lastSeen.size > 0) {
      this.resume(
        Array.from(this.lastSeen.entries()).map(([id, lastSeenMessageNumber]) => ({
          id,
          lastSeenMessageNumber,
        }))
      );
    }
  }

  /**
   * Schedules a reconnect attempt after an unrequested close, per KTD6's
   * "a few retries, not infinite" requirement. Never runs after an
   * explicit disconnect() call, and stops entirely once
   * RECONNECT_DELAYS_MS is exhausted — a caller (e.g. the conversation
   * page) is expected to notice `isConnected` staying false and fall back
   * to polling rather than this module retrying forever in the background.
   */
  private scheduleReconnect(): void {
    if (this.explicitDisconnect) return;
    if (this.reconnectTimer) return; // Already scheduled — never stack timers.

    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempts];
    if (delay === undefined) return; // Exhausted all retries — give up quietly.

    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // openSocket()'s own onclose handler already re-scheduled the next
        // attempt (or gave up, if exhausted) — nothing further to do here.
      });
    }, delay);
  }

  /** Closes the connection, if open. Safe to call when already closed.
   *  An explicit disconnect() cancels any pending/future reconnect attempt
   *  and clears registered last-seen cursors — this is a deliberate "I'm
   *  done with this session" call, not a transient drop to recover from. */
  disconnect(): void {
    this.explicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.lastSeen.clear();
    this.socket?.close();
    this.socket = null;
    this.connectPromise = null;
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Tells the server this client is actively viewing `conversationId` —
   * matching U1's enter_conversation protocol. A socket that has entered a
   * conversation receives full message payloads for it instead of
   * badge-only events (realtimeDelivery.ts's suppression rule). No-op if
   * not currently connected — a reconnect's automatic resume() (see
   * openSocket above) is what recovers a conversation's state across a
   * disconnect, not this method being queued.
   */
  enterConversation(conversationId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "enter_conversation", conversationId }));
  }

  /** Tells the server this client is no longer actively viewing any
   *  conversation — matching U1's leave_conversation protocol. */
  leaveConversation(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "leave_conversation" }));
  }

  /**
   * Tells the server this client is actively typing in `conversationId` —
   * matching U7's `typing` protocol (gatekept/backend/src/services/
   * typingIndicator.ts). Mirrors enterConversation's exact shape: guard on
   * `readyState === OPEN`, no-op (does not throw) if not currently
   * connected. Callers are expected to debounce their own calls to this
   * method (see the conversation page's TYPING_SEND_INTERVAL_MS) — this
   * wrapper sends unconditionally on every call, it does not itself
   * throttle.
   */
  sendTyping(conversationId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "typing", conversationId }));
  }

  /**
   * Tells the server this client has received message `messageNumber` in
   * `conversationId` — matching U2's `delivered` protocol
   * (gatekept/backend/src/services/messageStatus.ts). Mirrors
   * enterConversation/sendTyping's exact shape: guard on
   * `readyState === OPEN`, no-op (does not throw) if not currently
   * connected. Called once per message received from the other
   * participant (see the conversation page's own dedup bookkeeping) — this
   * wrapper sends unconditionally on every call, it does not itself
   * dedupe or throttle.
   */
  sendDelivered(conversationId: string, messageNumber: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "delivered", conversationId, messageNumber }));
  }

  /**
   * Registers (or updates) this client's current last-seen
   * `message_number` for a conversation — KTD6's per-connection resume
   * cursor. Callers (the conversation page) call this whenever they render
   * a message, live or historical, so that whenever this socket next
   * reconnects, `resume()` is called automatically with an up-to-date
   * cursor. Passing `null` removes the registration (e.g. when a caller
   * navigates away from a conversation and no longer wants it included in
   * future automatic resumes).
   */
  setLastSeen(conversationId: string, messageNumber: number | null): void {
    if (messageNumber === null) {
      this.lastSeen.delete(conversationId);
      return;
    }
    this.lastSeen.set(conversationId, messageNumber);
  }

  /** Returns the currently-registered last-seen cursor for a conversation,
   *  or `null` if none is registered — mainly a test/observability seam. */
  getLastSeen(conversationId: string): number | null {
    return this.lastSeen.get(conversationId) ?? null;
  }

  /**
   * Sends `{ type: "resume", conversations: [...] }` — KTD6's reconnect
   * handshake (gatekept/backend/src/services/realtimeResume.ts is the
   * server-side handler). Called automatically on a successful reconnect
   * (see openSocket above) with every registered `setLastSeen()` entry, but
   * also exposed directly so a caller can trigger a resume for a specific
   * set of conversations on demand (e.g. right after its own initial
   * `enterConversation()` on first mount, to catch anything that arrived
   * between the page's last HTTP fetch and the socket opening). No-op if
   * not currently connected, matching enterConversation/leaveConversation's
   * own posture.
   */
  resume(conversations: { id: string; lastSeenMessageNumber: number }[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (conversations.length === 0) return;
    this.socket.send(JSON.stringify({ type: "resume", conversations }));
  }

  /**
   * Subscribes to incoming full-message, badge, resume_fallback, typing,
   * and status events. Returns an unsubscribe function (standard
   * observer-cleanup shape, matching how the rest of this codebase tears
   * down effects/listeners).
   */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Subscribes to disconnect notifications (socket closed, for any
   *  reason — network drop, server-side eviction/ban, or an explicit
   *  disconnect() call). Fires on EVERY close, including ones this client
   *  will automatically try to recover from via scheduleReconnect() — a
   *  listener that wants to know "should I fall back to polling right
   *  now" should check `isConnected` after its own short grace period, or
   *  rely on the conversation page's own reconnect-exhaustion handling,
   *  rather than treating every onDisconnect firing as terminal. Returns
   *  an unsubscribe function. */
  onDisconnect(listener: ConnectionListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }
}

// App-wide singleton — see the class's own doc comment for why one shared
// connection per tab is the intended usage, not one per consumer/component.
let singleton: GatekeptRealtimeClient | null = null;

export function getRealtimeClient(): GatekeptRealtimeClient {
  if (typeof window === "undefined") {
    // SSR/build-time guard: never construct a real WebSocket-touching
    // client outside the browser. Callers only ever use this from "use
    // client" components' effects, which run client-side only, but this
    // keeps the module import itself side-effect-free during SSR.
    return new GatekeptRealtimeClient();
  }
  if (!singleton) {
    singleton = new GatekeptRealtimeClient();
  }
  return singleton;
}
