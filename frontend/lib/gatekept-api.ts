// Typed client for the Gatekept messaging backend (proxied same-origin via
// /api/gatekept, see next.config.ts). Adapted from gatekept/web/lib/api.ts —
// this build runs inside Editor Club's own session: it reads Editor Club's
// own JWT via getToken() (frontend/lib/auth.ts) instead of maintaining a
// separate token/localStorage key, and talks to Gatekept's ID-keyed identity
// routes (GET /keys/:userId/bundle) rather than the old handle-keyed ones —
// Gatekept's backend no longer has handle-keyed routes at all.

import { getToken } from "./auth";
import { generatePlaceholderIdentity } from "./gatekept-crypto";

const API_BASE = "/api/gatekept";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "unknown_error", body.message ?? "Request failed");
  }

  return body as T;
}

// ── Identity ──────────────────────────────────────────────────────────────

export interface PreKeyBundleResponse {
  registrationId: number;
  deviceId: number;
  identityKey: string;
  signedPreKey: { id: number; publicKey: string; signature: string };
  kyberPreKey: { id: number; publicKey: string; signature: string };
  oneTimePreKey: { id: number; publicKey: string } | null;
}

/** ID-keyed prekey bundle lookup — Gatekept's backend no longer has a
 *  handle-keyed equivalent (GET /v1/identity/keys/:handle/bundle is gone). */
export function getPreKeyBundle(userId: string) {
  return request<PreKeyBundleResponse>(`/v1/identity/keys/${userId}/bundle`);
}

export function getScannerBundle() {
  return request<PreKeyBundleResponse>("/v1/scanner/bundle");
}

// ── First-use key registration ───────────────────────────────────────────
//
// POST /v1/identity/register-keys is the replacement for Gatekept's old
// account creation: a logged-in Editor Club user's first messaging
// interaction registers their (placeholder) key material under their
// already-verified identity — no client anywhere ever called this before
// this fix, which meant NO user had a Gatekept-side row until they
// happened to be looked up by someone else first, so both sending a first
// message (needs the RECIPIENT's bundle) and being messaged (needs the
// SENDER'S row to exist for chat_requests' FK) 404'd with "User" not found
// for every real account. Every /messages/* page calls ensureRegistered()
// once per browser session (sessionStorage-gated, not on every navigation)
// before doing anything else — safe to call repeatedly regardless, since
// the backend's upsertMessagingProfile is an idempotent ON CONFLICT UPDATE.
const REGISTERED_FLAG_KEY = "gatekept_registered";

export async function ensureRegistered(): Promise<void> {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem(REGISTERED_FLAG_KEY) === "1") return;

  const identity = generatePlaceholderIdentity();
  await request<{ id: string }>("/v1/identity/register-keys", {
    method: "POST",
    body: JSON.stringify(identity),
  });
  sessionStorage.setItem(REGISTERED_FLAG_KEY, "1");
}

// ── Chat requests ─────────────────────────────────────────────────────────

export interface ChatRequestSummary {
  id: string;
  senderId: string;
  ciphertext: string;
  ciphertextType: "prekey" | "whisper";
  senderRegistrationId: number;
  senderDeviceId: number;
  createdAt: string;
}

export function sendChatRequest(payload: {
  recipientId: string;
  recipientCiphertext: string;
  recipientCiphertextType: "prekey" | "whisper";
  scannerCiphertext: string;
  senderRegistrationId: number;
  senderDeviceId: number;
}) {
  return request<{ requestId: string }>("/v1/chat-requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listPendingRequests() {
  return request<{ requests: ChatRequestSummary[] }>("/v1/chat-requests");
}

export function acceptChatRequest(id: string) {
  return request<{ conversationId: string }>(`/v1/chat-requests/${id}/accept`, {
    method: "POST",
  });
}

export function rejectChatRequest(id: string) {
  return request<void>(`/v1/chat-requests/${id}/reject`, { method: "POST" });
}

export function withdrawChatRequest(id: string) {
  return request<void>(`/v1/chat-requests/${id}/withdraw`, { method: "POST" });
}

// ── Conversations / messages ──────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  otherParticipantId: string;
  status: "active" | "blocked_by_a" | "blocked_by_b" | "closed";
  createdAt: string;
}

export function listConversations() {
  return request<{ conversations: ConversationSummary[] }>("/v1/conversations");
}

export interface MessageSummary {
  id: string;
  senderId: string;
  ciphertext: string;
  ciphertextType: "prekey" | "whisper";
  messageNumber: number;
  attachmentRef: string | null;
  sentAt: string;
}

export function sendMessage(
  conversationId: string,
  payload: { ciphertext: string; ciphertextType: "prekey" | "whisper"; messageNumber: number }
) {
  return request<{ id: string; sentAt: string }>(`/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMessages(conversationId: string, since = -1) {
  return request<{ messages: MessageSummary[] }>(
    `/v1/conversations/${conversationId}/messages?since=${since}`
  );
}

// ── Blocks ────────────────────────────────────────────────────────────────

export function blockUser(blockedUserId: string, context: "pre_accept" | "post_accept" = "pre_accept") {
  return request<{ id: string; blockedId: string }>("/v1/blocks", {
    method: "POST",
    body: JSON.stringify({ blockedUserId, context }),
  });
}

export function unblockUser(blockedUserId: string) {
  return request<void>(`/v1/blocks/${blockedUserId}`, { method: "DELETE" });
}

export function listBlocks() {
  return request<{ blocks: Array<{ blockedId: string; createdAt: string }> }>("/v1/blocks");
}

// ── Reports ───────────────────────────────────────────────────────────────

export function fileReport(payload: {
  reportedUserId: string;
  category: "spam" | "harassment" | "csam" | "impersonation" | "other";
  chatRequestId?: string;
  conversationId?: string;
  evidence?: { plaintextExcerpt?: string };
}) {
  return request<{ id: string; status: string }>("/v1/reports", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Editor Club user search (find-people + name resolution) ────────────────
//
// These two calls hit Editor Club's own FastAPI backend (via /api/backend,
// not /api/gatekept) — they're grouped here because they're part of the same
// "find and identify people to message" flow, even though they're a
// different origin under the hood.

export interface DirectoryUser {
  id: string;
  name: string;
  account_type: string;
}

/** GET /api/backend/search-users?q=... — searches all account_types (not
 *  just creators, unlike Editor Club's existing /search). Requires auth. */
export async function searchUsers(q: string): Promise<DirectoryUser[]> {
  const token = getToken();
  const res = await fetch(`/api/backend/search-users?q=${encodeURIComponent(q)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

// Module-level cache: id -> resolved name, shared across every call site for
// the lifetime of the page/session. Keeps repeat navigation (requests list ->
// conversation view -> back) from re-resolving names it already knows.
const nameCache = new Map<string, string>();

/**
 * Resolves a batch of user IDs to display names via
 * POST /api/backend/search-users/by-ids. Results are cached in-memory by id
 * so repeated calls (e.g. navigating between the requests inbox and a
 * conversation) don't redundantly re-fetch names already known.
 *
 * IDs already present in the cache are never re-requested. Any id the
 * lookup doesn't return (deleted account, bad id, etc.) is left out of the
 * returned map entirely — callers should fall back to a short id fragment
 * for those rather than treating a miss as an error.
 */
export async function resolveUserNames(ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids));
  const uncached = unique.filter((id) => !nameCache.has(id));

  if (uncached.length > 0) {
    const token = getToken();
    const res = await fetch("/api/backend/search-users/by-ids", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ids: uncached }),
    });
    if (res.ok) {
      const found: DirectoryUser[] = await res.json();
      for (const u of found) nameCache.set(u.id, u.name);
    }
    // A failed batch lookup is not fatal — callers fall back to an id
    // fragment for anything still missing from the cache below.
  }

  const result: Record<string, string> = {};
  for (const id of unique) {
    const cached = nameCache.get(id);
    if (cached) result[id] = cached;
  }
  return result;
}

// ── Web Push subscriptions (issue #24 / U5) ─────────────────────────────
//
// Thin client over the browser's native Push API
// (navigator.serviceWorker.register + PushManager.subscribe), wired to the
// two new backend routes (POST/DELETE /v1/push-subscriptions — see
// gatekept/backend/src/routes/pushSubscriptions.ts). The service worker
// itself (public/sw.js) only handles displaying an incoming push — this
// module owns the subscribe/unsubscribe lifecycle and talking to the
// backend, mirroring how gatekept-ws.ts owns the WebSocket connection
// lifecycle as its own dedicated module rather than folding it into this
// generic request() helper.
//
// VAPID PUBLIC KEY: exposed via a build-time NEXT_PUBLIC_ env var (Next.js's
// standard mechanism for values that must reach the browser bundle) rather
// than a runtime fetch — this codebase has no existing "fetch config from
// backend" pattern to follow (next.config.ts's own BACKEND_URL/
// GATEKEPT_BACKEND_URL constants are resolved at build/server time, not
// fetched), and a VAPID public key is not secret (it's sent to every
// subscribing browser and to the push service itself by design), so a
// public build-time env var is the natural fit, not a compromise.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const SERVICE_WORKER_PATH = "/sw.js";

/** Converts a URL-safe base64 VAPID public key string into the raw
 *  BufferSource PushManager.subscribe's applicationServerKey option expects
 *  — the browser Push API has no built-in base64 decoding for this.
 *  Explicitly typed as `Uint8Array<ArrayBuffer>` (via `new
 *  ArrayBuffer(...)` backing rather than a bare `new Uint8Array(length)`)
 *  because TypeScript's DOM lib types `applicationServerKey` as
 *  `BufferSource`, which requires an `ArrayBuffer`-backed view — a plain
 *  `Uint8Array` can be backed by the wider `ArrayBufferLike` (which also
 *  covers `SharedArrayBuffer`) and does not satisfy that constraint. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

/** Returns the browser's current push subscription for this app, or null
 *  if the service worker isn't registered/active or there's no active
 *  subscription — never throws, since "not subscribed yet" is a normal
 *  state, not an error. */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Registers the service worker (idempotent — registering an already-
 * registered worker at the same scope is a no-op per the spec), subscribes
 * to Web Push via the browser's native PushManager, and registers that
 * subscription with the backend via POST /v1/push-subscriptions.
 *
 * Throws if push isn't supported in this browser/environment, if the user
 * denies the notification permission prompt, or if the backend call fails
 * — callers (the profile page's toggle) are expected to catch and surface
 * this as a user-facing error rather than this function swallowing it,
 * since a failed subscribe is something the user actively asked for and
 * should know didn't work (unlike the backend's own notification sends,
 * which fail silently by design).
 */
export async function subscribeToPush(): Promise<{ id: string }> {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported in this browser");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned an incomplete push subscription");
  }

  return request<{ id: string }>("/v1/push-subscriptions", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
}

/**
 * Unsubscribes the browser's current push subscription (if any) both
 * locally (PushManager.unsubscribe) and on the backend (DELETE
 * /v1/push-subscriptions/:id). `subscriptionId` is the id returned by a
 * prior subscribeToPush() call — callers are expected to have persisted it
 * (e.g. in the profile page's own component state or localStorage) since
 * the browser's PushSubscription object itself carries no backend row id.
 *
 * Safe to call even if the browser-side subscription is already gone
 * (e.g. the backend already deleted it after a 410) — unsubscribing
 * locally in that case is a no-op, and the DELETE call below still runs to
 * clean up the (possibly already-deleted) backend row; a 404 from an
 * already-deleted row is treated as success from this function's
 * perspective, since the end state (no subscription) is what the caller
 * actually wants.
 */
export async function unsubscribeFromPush(subscriptionId: string): Promise<void> {
  const existing = await getExistingPushSubscription();
  if (existing) {
    await existing.unsubscribe();
  }

  try {
    await request<void>(`/v1/push-subscriptions/${subscriptionId}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    throw err;
  }
}
