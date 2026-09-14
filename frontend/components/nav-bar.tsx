"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Upload, User, MessageCircle } from "lucide-react";
import { isLoggedIn, isCreator } from "@/lib/auth";

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

export default function NavBar() {
  const pathname = usePathname();

  // Auth state is read straight from localStorage on every render instead of
  // being mirrored into useState — it's synchronous and cheap, and deriving
  // it during render (rather than via a setState-in-effect) avoids the extra
  // render pass React now warns about. Next.js re-renders this component on
  // every navigation, so this naturally re-checks auth right after login/logout.
  const loggedIn = isLoggedIn();
  const creator = isCreator();

  if (!loggedIn) return null;

  const visible = NAV_ITEMS.filter(i => !i.creatorOnly || creator);

  return (
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
              <span className="shrink-0">{item.icon}</span>
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
  );
}
