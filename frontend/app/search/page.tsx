"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { searchAll, followCreator, unfollowCreator, type SearchResult } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

const chip: React.CSSProperties = {
  fontSize: "11px", fontWeight: 600, padding: "2px 8px",
  borderRadius: "999px", background: "var(--accent-bg)",
  color: "var(--accent)", border: "1px solid var(--accent)",
};

export default function SearchPage() {
  const router = useRouter();
  const [q, setQ]                 = useState("");
  const [results, setResults]     = useState<SearchResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [apiError, setApiError]   = useState("");
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search: fires 400ms after the user stops typing
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) return;
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setApiError("");
      try {
        const data = await searchAll(trimmed);
        setResults(data);
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "Search failed");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [q]);

  // Clearing the query is a direct response to user input, not something
  // the debounce effect needs to react to — handled here instead of as a
  // synchronous setState at the top of the effect body.
  function handleInput(val: string) {
    setQ(val);
    if (!val.trim()) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setResults(null);
      setApiError("");
    }
  }

  async function toggleFollow(creatorId: string, currentlyFollowing: boolean) {
    if (!isLoggedIn()) { router.push("/"); return; }
    setFollowing(f => ({ ...f, [creatorId]: !currentlyFollowing }));
    try {
      if (currentlyFollowing) await unfollowCreator(creatorId);
      else await followCreator(creatorId);
    } catch {
      setFollowing(f => ({ ...f, [creatorId]: currentlyFollowing }));
    }
  }

  const hasResults = results && (results.creators.length > 0 || results.videos.length > 0);

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Search</h1>
        <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>Find creators and videos</p>
      </div>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: "24px" }}>
        <svg style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--fg-muted)", pointerEvents: "none" }}
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          value={q}
          onChange={e => handleInput(e.target.value)}
          placeholder="Search creators, departments, videos…"
          autoFocus
          style={{
            width: "100%", paddingLeft: "42px", paddingRight: "42px",
            paddingTop: "12px", paddingBottom: "12px",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "12px", fontSize: "14px", color: "var(--fg)", outline: "none",
            boxSizing: "border-box",
          }}
        />
        {/* Clear button */}
        {q && !loading && (
          <button onClick={() => handleInput("")} style={{
            position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer", color: "var(--fg-muted)",
            fontSize: "18px", lineHeight: 1, padding: "2px 4px",
          }}>×</button>
        )}
        {/* Loading spinner dot */}
        {loading && (
          <div style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "3px" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)",
                animation: `pulse 1s ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>

      {/* Empty start state */}
      {!q && (
        <div style={{ textAlign: "center", paddingTop: "60px", color: "var(--fg-muted)" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            style={{ margin: "0 auto 12px", display: "block", opacity: 0.35 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p style={{ fontSize: "14px", fontWeight: 500 }}>Find filmmakers on Editor Club</p>
          <p style={{ fontSize: "12px", marginTop: "6px", opacity: 0.6 }}>Search by name, department, or video title</p>
        </div>
      )}

      {/* API error */}
      {apiError && (
        <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#7f1d1d22", border: "1px solid #7f1d1d55", fontSize: "13px", color: "#f87171", marginBottom: "16px" }}>
          Could not reach search — check your connection. ({apiError})
        </div>
      )}

      {/* No results */}
      {q && !loading && !apiError && results && !hasResults && (
        <div style={{ textAlign: "center", paddingTop: "48px", color: "var(--fg-muted)" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            style={{ margin: "0 auto 10px", display: "block", opacity: 0.35 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="8" x2="14" y2="14" strokeWidth="2"/><line x1="14" y1="8" x2="8" y2="14" strokeWidth="2"/>
          </svg>
          <p style={{ fontSize: "14px", fontWeight: 500 }}>No results for &ldquo;{q}&rdquo;</p>
          <p style={{ fontSize: "12px", marginTop: "6px", opacity: 0.6 }}>Try a shorter word or check the spelling</p>
        </div>
      )}

      {/* Creators section */}
      {results && results.creators.length > 0 && (
        <div style={{ marginBottom: "28px" }}>
          <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
            Creators
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {results.creators.map(c => {
              const isF = following[c.id] ?? false;
              return (
                <div key={c.id} style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "12px", padding: "14px 16px",
                  display: "flex", alignItems: "center", gap: "14px",
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: "44px", height: "44px", borderRadius: "50%", flexShrink: 0,
                    background: "var(--accent)", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "#fff",
                  }}>{c.name.charAt(0).toUpperCase()}</div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Link href={`/creators/${c.id}`} style={{ fontWeight: 600, fontSize: "14px", color: "var(--fg)", textDecoration: "none" }}>
                        {c.name}
                      </Link>
                      <span style={chip}>CREATOR</span>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>
                      {c.department ?? "Filmmaker"} · {c.follower_count} followers · {c.credits} credits
                    </p>
                  </div>

                  {/* Enroute / Deroute */}
                  <button
                    onClick={() => toggleFollow(c.id, isF)}
                    style={{
                      padding: "7px 16px", fontSize: "13px", fontWeight: 600,
                      borderRadius: "999px", cursor: "pointer", flexShrink: 0,
                      background: isF ? "transparent" : "var(--accent)",
                      color: isF ? "var(--fg-muted)" : "#fff",
                      border: isF ? "1px solid var(--border)" : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {isF ? "Deroute" : "Enroute"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Videos section */}
      {results && results.videos.length > 0 && (
        <div>
          <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
            Videos
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {results.videos.map(v => (
              <div key={v.id} style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "12px", padding: "14px 16px",
                display: "flex", alignItems: "center", gap: "14px",
              }}>
                {/* Video icon */}
                <div style={{
                  width: "44px", height: "44px", borderRadius: "10px", flexShrink: 0,
                  background: "var(--bg)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: "13px", color: "var(--fg)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.filename.replace(/\.[^/.]+$/, "")}
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>
                    {v.creator_name ?? "Unknown"} · {v.creator_department ?? ""}
                  </p>
                </div>

                <span style={{
                  fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "999px", flexShrink: 0,
                  background: v.overall_status === "approved" ? "#c2542322" : "#b4550022",
                  color: v.overall_status === "approved" ? "#e08a5f" : "#fb923c",
                  border: `1px solid ${v.overall_status === "approved" ? "#c2542344" : "#b4550044"}`,
                }}>
                  {v.overall_status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
