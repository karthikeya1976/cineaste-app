"use client";

// Privacy settings — Blocked users. Wires up the "Privacy" row on
// /profile (previously a static "Soon" placeholder) to a real page.
//
// Blocking someone (via the messenger's Block action) now hides that
// conversation from /messages/conversations entirely rather than leaving
// it visible read-only (see gatekept's GET /v1/conversations, which was
// changed to list only 'active' conversations) — this page is where that
// person actually surfaces afterward, with an Unblock affordance, so
// blocking isn't a one-way trip to nowhere.
//
// Unblocking here does NOT restore the old conversation (blockService's
// unblockUser deliberately never resets a conversation's status back to
// 'active' — reconnecting requires a fresh chat request from either
// party); this page only removes the person from the Blocked list.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listBlocks, unblockUser, resolveUserNames } from "@/lib/gatekept-api";
import { Avatar } from "@/components/Avatar";
import { isLoggedIn } from "@/lib/auth";

interface BlockedUserRow {
  blockedId: string;
  createdAt: string;
}

function nameFor(names: Record<string, string>, id: string): string {
  return names[id] ?? `${id.slice(0, 8)}…`;
}

export default function PrivacySettingsPage() {
  const router = useRouter();
  const [blocks, setBlocks] = useState<BlockedUserRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/");
      return;
    }
    // Inlined as an async IIFE, rather than a separately-defined
    // useCallback invoked here, so this effect's setState calls (on the
    // success/catch/finally paths) are all lexically inside the effect
    // body itself — a useCallback wrapper around the same try/catch/finally
    // shape trips this project's react-hooks/set-state-in-effect rule
    // (React Compiler's flow analysis loses track of the callback
    // boundary), even though the actual runtime behavior is identical.
    (async () => {
      try {
        const { blocks: fetched } = await listBlocks();
        setBlocks(fetched);
        const ids = fetched.map((b) => b.blockedId);
        if (ids.length > 0) {
          const resolved = await resolveUserNames(ids);
          setNames((prev) => ({ ...prev, ...resolved }));
        }
      } catch {
        setError("Could not load your blocked users list.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function handleUnblock(blockedId: string) {
    setUnblockingId(blockedId);
    setError("");
    try {
      await unblockUser(blockedId);
      setBlocks((prev) => prev.filter((b) => b.blockedId !== blockedId));
    } catch {
      setError("Could not unblock this person. Try again.");
    } finally {
      setUnblockingId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center", paddingTop: "80px", color: "var(--fg-muted)" }}>
        <p style={{ fontSize: "14px" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <Link
        href="/profile"
        style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          background: "none", border: "none", cursor: "pointer",
          color: "var(--fg-muted)", fontSize: "13px", marginBottom: "20px",
          textDecoration: "none",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Profile
      </Link>

      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Privacy</h1>
        <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>
          People you&apos;ve blocked can&apos;t message you, and their conversation is hidden from your list.
        </p>
      </div>

      {error && (
        <p style={{ fontSize: "13px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "10px 12px", marginBottom: "16px" }}>
          {error}
        </p>
      )}

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>Blocked users</h2>
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "16px" }}>
          {blocks.length === 0 ? "You haven't blocked anyone." : `${blocks.length} blocked ${blocks.length === 1 ? "person" : "people"}`}
        </p>

        {blocks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {blocks.map((b) => (
              <div
                key={b.blockedId}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "14px", padding: "10px 0", borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                  <Avatar name={nameFor(names, b.blockedId)} size={36} />
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--fg)" }}>
                    {nameFor(names, b.blockedId)}
                  </span>
                </span>
                <button
                  onClick={() => handleUnblock(b.blockedId)}
                  disabled={unblockingId === b.blockedId}
                  style={{
                    fontSize: "12px", fontWeight: 600, padding: "6px 14px", borderRadius: "999px",
                    border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)",
                    cursor: unblockingId === b.blockedId ? "not-allowed" : "pointer",
                    opacity: unblockingId === b.blockedId ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {unblockingId === b.blockedId ? "…" : "Unblock"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
