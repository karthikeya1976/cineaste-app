// Typed client for the Gatekept messaging backend (proxied same-origin via
// /api/gatekept, see next.config.ts). Adapted from gatekept/web/lib/api.ts —
// this build runs inside Editor Club's own session: it reads Editor Club's
// own JWT via getToken() (frontend/lib/auth.ts) instead of maintaining a
// separate token/localStorage key, and talks to Gatekept's ID-keyed identity
// routes (GET /keys/:userId/bundle) rather than the old handle-keyed ones —
// Gatekept's backend no longer has handle-keyed routes at all.

import { getToken } from "./auth";

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
