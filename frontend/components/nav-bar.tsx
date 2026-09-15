"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, Search, Upload, User, MessageCircle } from "lucide-react";
import { isLoggedIn, isCreator } from "@/lib/auth";
import { getRealtimeClient, type RealtimeEvent } from "@/lib/gatekept-ws";
import { recordBadgeEvent, clearNavDot, isNavDotVisible, subscribeNavDot } from "@/lib/gatekept-notifications";
import MessageToast from "@/components/MessageToast";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  creatorOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/feed",     label: "Home",     icon: <Home          size={20} /> },
  { href: "/search",   label: "Search",   icon: <Search        size={20} /> },
  { href: "/messages", label: "Messages", icon: <MessageCircle size={20} /> },
  { href: "/upload",   label: "Upload",   icon: <Upload        size={20} />, creatorOnly: true },
];

// Routes whose arrival clears the nav dot — per the plan's Notification UI
// subsection: "clears the moment the user navigates to
// /messages/requests or /messages/conversations (arrival at the list, not
// per-item read state)". Deliberately NOT /messages itself (the
// find-people/compose page) or a specific conversation's own URL — only
// these two list pages.
const NAV_DOT_CLEARING_ROUTES = ["/messages/requests", "/messages/conversations"];

export default function NavBar() {
  const pathname = usePathname();

  // Auth state is read straight from localStorage on every render instead of
  // being mirrored into useState — it's synchronous and cheap, and deriving
  // it during render (rather than via a setState-in-effect) avoids the extra
  // render pass React now warns about. Next.js re-renders this component on
  // every navigation, so this naturally re-checks auth right after login/logout.
  const loggedIn = isLoggedIn();
  const creator = isCreator();

  const [navDotVisible, setNavDotVisible] = useState(isNavDotVisible);

  // Owns the single app-wide realtime connection: connects once while
  // logged in, routes every incoming badge/message event into
  // gatekept-notifications' shared store (which the nav dot below, the
  // toast stack, and the requests/conversations list pages all read from).
  // NavBar is the only component guaranteed mounted on every page for a
  // logged-in user (it lives in the root layout), which is why the
  // connection and toast stack are owned here rather than in a
  // page-specific component — see gatekept-ws.ts's own header comment on
  // why one shared connection per tab is intended, not one per consumer.
  useEffect(() => {
    if (!loggedIn) return;

    const client = getRealtimeClient();
    let cancelled = false;

    void client.connect().catch(() => {
      // Best-effort: a failed realtime connection degrades to "no
      // real-time nudges this session" — the existing 3s HTTP polling on
      // the conversation page and manual navigation to the requests/
      // conversations lists remain fully functional either way (KTD2's
      // rationale: Postgres is always the source of truth).
    });

    const unsubscribeEvent = client.onEvent((event: RealtimeEvent) => {
      if (cancelled) return;
      if (event.type !== "badge") return; // full message events are for an
      // actively-entered conversation view (not yet wired to a live UI in
      // this issue's scope — U4/the conversation page's own WS wiring is a
      // later issue); only badge events drive the notification UI here.
      recordBadgeEvent({
        reason: event.reason,
        chatRequestId: event.chatRequestId,
        conversationId: event.conversationId,
        senderId: event.senderId,
      });
    });

    return () => {
      cancelled = true;
      unsubscribeEvent();
      // Deliberately does NOT call client.disconnect() — the connection is
      // app-wide (singleton) and other mounted consumers (e.g. a
      // conversation page in a later issue) may still want it; NavBar
      // itself is expected to stay mounted for the lifetime of a logged-in
      // session anyway (root layout), so in practice this cleanup only
      // runs on a genuine unmount (logout via the loggedIn dependency
      // change below, or the whole app tearing down).
    };
  }, [loggedIn]);

  // Mirrors the shared nav-dot boolean into local state so this component
  // re-renders when it changes (the store itself is plain module state,
  // not React state — see gatekept-notifications.ts's own header comment
  // for why).
  useEffect(() => {
    const unsubscribe = subscribeNavDot(() => setNavDotVisible(isNavDotVisible()));
    return unsubscribe;
  }, []);

  // Clears the nav dot on arrival at either list page — see
  // NAV_DOT_CLEARING_ROUTES's own comment.
  useEffect(() => {
    if (NAV_DOT_CLEARING_ROUTES.includes(pathname)) {
      clearNavDot();
    }
  }, [pathname]);

  if (!loggedIn) return null;

  const visible = NAV_ITEMS.filter(i => !i.creatorOnly || creator);

  return (
    <>
      <aside
        className="group fixed left-0 top-0 h-full z-40 flex flex-col overflow-hidden
                   w-14 hover:w-52 transition-all duration-200 ease-in-out"
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}
      >
      {/* Logo — navigates to home feed */}
      <Link href="/feed" className="flex items-center px-4 py-5 min-h-[64px] overflow-hidden"
           style={{ borderBottom: "1px solid var(--border)", textDecoration: "none" }}>
        {/* Collapsed: show "EC" monogram; expanded: show full name */}
        <span className="font-black text-base tracking-tight whitespace-nowrap shrink-0
                         group-hover:hidden"
              style={{ color: "var(--accent)" }}>
          EC
        </span>
        <span className="font-black text-base tracking-tight whitespace-nowrap hidden
                         group-hover:block"
              style={{ color: "var(--accent)" }}>
          Editor Club
        </span>
      </Link>

      {/* Links */}
      <nav className="flex flex-col gap-1 px-2 pt-4 flex-1">
        {visible.map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-2 py-2.5 rounded-lg transition-colors"
              style={{
                background: active ? "var(--accent)" : "transparent",
                color: active ? "#fff" : "var(--fg-muted)",
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--accent-bg)"; (e.currentTarget as HTMLElement).style.color = "var(--fg)"; }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)"; } }}
            >
              <span className="shrink-0" style={{ position: "relative" }}>
                {item.icon}
                {/* Unread-indicator dot — binary presence/absence only, per
                    the plan's Notification UI subsection: "a small solid
                    dot, var(--accent), positioned top-right of the existing
                    MessageCircle icon, visible in both the nav's collapsed
                    (56px) and hover-expanded (208px) states." Anchored to
                    the icon span itself (not the label, which fades
                    in/out between states) so it stays visibly correct in
                    both. */}
                {item.href === "/messages" && navDotVisible && (
                  <span
                    aria-label="Unread messages"
                    style={{
                      position: "absolute",
                      top: "-2px",
                      right: "-2px",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "var(--accent)",
                      border: "1.5px solid var(--surface)",
                    }}
                  />
                )}
              </span>
              <span className="text-sm font-medium whitespace-nowrap
                               opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Profile — pinned to bottom */}
      <div className="px-2 pb-4" style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
        {(() => {
          const active = pathname === "/profile";
          return (
            <Link
              href="/profile"
              className="flex items-center gap-3 px-2 py-2.5 rounded-lg transition-colors"
              style={{
                background: active ? "var(--accent)" : "transparent",
                color: active ? "#fff" : "var(--fg-muted)",
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--accent-bg)"; (e.currentTarget as HTMLElement).style.color = "var(--fg)"; }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)"; } }}
            >
              <User size={20} className="shrink-0" />
              <span className="text-sm font-medium whitespace-nowrap
                               opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                Profile
              </span>
            </Link>
          );
        })()}
      </div>
      </aside>
      <MessageToast />
    </>
  );
}
