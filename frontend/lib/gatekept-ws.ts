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
// SECOND CONSUMER (U4, not built here): this module's public surface
// (connect/enterConversation/leaveConversation/subscribe/disconnect) is
// kept deliberately small and stable so a later reconnect/resume unit can
// build on top of it (e.g. wrapping connect() with retry logic) without
// needing to change its shape — see the issue's own "Out of Scope" note.
// No resume/reconnect logic is implemented here: a dropped connection
// simply calls onDisconnect subscribers and stays disconnected until
// something calls connect() again.
import { getToken } from "./auth";

export type FullMessageEvent = {
  type: "message";
  conversationId: string;
  messageNumber: number;
  senderId: string;
};

export type BadgeEvent = {
  type: "badge";
  reason: "chat_request" | "message";
  chatRequestId?: string;
  conversationId?: string;
  senderId?: string;
};

export type RealtimeEvent = FullMessageEvent | BadgeEvent;

type EventListener = (event: RealtimeEvent) => void;
type ConnectionListener = () => void;

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
    if (type === "message" || type === "badge") {
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

  /**
   * Fetches a ticket and opens the WebSocket connection. Idempotent while
   * already connecting/connected — a second call reuses the in-flight or
   * established connection rather than opening a duplicate socket.
   */
  connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return this.connectPromise ?? Promise.resolve();
    }

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
      };

      this.socket = ws;
    });
  }

  /** Closes the connection, if open. Safe to call when already closed. */
  disconnect(): void {
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
   * not currently connected — callers are not expected to queue this
   * across a disconnected period (that's resume/reconnect territory, U4,
   * explicitly out of scope here).
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
   * Subscribes to incoming full-message and badge events. Returns an
   * unsubscribe function (standard observer-cleanup shape, matching how
   * the rest of this codebase tears down effects/listeners).
   */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Subscribes to disconnect notifications (socket closed, for any
   *  reason — network drop, server-side eviction/ban, or an explicit
   *  disconnect() call). Returns an unsubscribe function. */
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
