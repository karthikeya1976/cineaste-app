// Shared in-memory notification state — issue #10 (frontend) / U3.
//
// Bridges the single app-wide realtime connection (gatekept-ws.ts) to the
// several places the plan's Notification UI subsection asks for a reaction
// to the same badge events: the nav-bar unread dot (nav-bar.tsx), the toast
// stack (MessageToast.tsx), and the unread-row treatment on both list pages
// (messages/requests/page.tsx, messages/conversations/page.tsx). Kept as a
// small plain module-level store (not React context) so any of those can
// subscribe independently without needing a shared provider ancestor —
// nav-bar.tsx already renders outside of app/messages/* entirely (it's in
// the root layout), so a context provider would need to live above both,
// which is more churn than this plan's scope justifies for what is, per
// the issue's own explicit cut, binary presence/absence state only (no
// counts, no read receipts).
//
// NUMERAL COUNTS ARE EXPLICITLY OUT OF SCOPE (issue's own "Out of Scope"
// list) — every piece of state here is a boolean/Set-membership check,
// never a count.
"use client";

export type BadgeReason = "chat_request" | "message";

export interface NotificationEvent {
  reason: BadgeReason;
  chatRequestId?: string;
  conversationId?: string;
  senderId?: string;
}

type Listener = () => void;
type EventListener = (event: NotificationEvent) => void;

// Binary nav-dot state: is there ANY unseen activity right now. Cleared by
// clearNavDot() (called on navigating to /messages/requests or
// /messages/conversations, per the issue's own acceptance criteria).
let navDotVisible = false;

// Per-id "has activity since last visit" sets, backing the requests/
// conversations list pages' unread-row treatment. A chat request's key is
// its chatRequestId; a conversation's key is its conversationId — kept as
// two separate sets since the two id spaces never overlap in practice but
// keeping them apart avoids ever having to disambiguate which kind an id
// belongs to.
const unreadChatRequestIds = new Set<string>();
const unreadConversationIds = new Set<string>();

const navDotListeners = new Set<Listener>();
const unreadRowListeners = new Set<Listener>();
const notificationListeners = new Set<EventListener>();

function notifyNavDot(): void {
  for (const l of navDotListeners) l();
}

function notifyUnreadRows(): void {
  for (const l of unreadRowListeners) l();
}

/**
 * Records a badge event arriving from the realtime connection: sets the
 * nav dot and the relevant per-id unread flag, and fans it out to any
 * toast-stack subscriber. This is the single entry point gatekept-ws.ts's
 * onEvent() badge events should be routed through — everything else in
 * this module is downstream state/subscriptions, not another ingestion
 * path.
 */
export function recordBadgeEvent(event: NotificationEvent): void {
  navDotVisible = true;
  if (event.reason === "chat_request" && event.chatRequestId) {
    unreadChatRequestIds.add(event.chatRequestId);
  }
  if (event.reason === "message" && event.conversationId) {
    unreadConversationIds.add(event.conversationId);
  }
  notifyNavDot();
  notifyUnreadRows();
  for (const l of notificationListeners) l(event);
}

/** Clears the nav dot — called on navigating to /messages/requests or
 *  /messages/conversations (arrival at the list, not per-item read state;
 *  matches the plan's own "clears the moment the user navigates" wording,
 *  distinct from per-row clearing via clearUnreadChatRequest/Conversation
 *  below). */
export function clearNavDot(): void {
  if (!navDotVisible) return;
  navDotVisible = false;
  notifyNavDot();
}

export function isNavDotVisible(): boolean {
  return navDotVisible;
}

export function subscribeNavDot(listener: Listener): () => void {
  navDotListeners.add(listener);
  return () => navDotListeners.delete(listener);
}

/** Clears one request row's unread flag — called when that row is opened. */
export function clearUnreadChatRequest(chatRequestId: string): void {
  if (!unreadChatRequestIds.delete(chatRequestId)) return;
  notifyUnreadRows();
}

/** Clears one conversation row's unread flag — called when that row is opened. */
export function clearUnreadConversation(conversationId: string): void {
  if (!unreadConversationIds.delete(conversationId)) return;
  notifyUnreadRows();
}

export function isChatRequestUnread(chatRequestId: string): boolean {
  return unreadChatRequestIds.has(chatRequestId);
}

export function isConversationUnread(conversationId: string): boolean {
  return unreadConversationIds.has(conversationId);
}

export function subscribeUnreadRows(listener: Listener): () => void {
  unreadRowListeners.add(listener);
  return () => unreadRowListeners.delete(listener);
}

/** Subscribes to every raw badge event, for the toast stack — distinct
 *  from the nav-dot/unread-row subscriptions above because a toast needs
 *  the actual event payload (to resolve a name and pick copy), not just
 *  "something changed". */
export function subscribeNotifications(listener: EventListener): () => void {
  notificationListeners.add(listener);
  return () => notificationListeners.delete(listener);
}

/** Test-only reset — clears all module-level state between test cases. */
export function __resetForTests(): void {
  navDotVisible = false;
  unreadChatRequestIds.clear();
  unreadConversationIds.clear();
  navDotListeners.clear();
  unreadRowListeners.clear();
  notificationListeners.clear();
}
