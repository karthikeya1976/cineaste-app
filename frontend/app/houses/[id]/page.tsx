"use client";

// Custom House detail route — Houses navigation feature (U4 + U5).
//
// Per KTD7 ("The /houses/[id] route is a thin redirect/pass-through into
// the feed, not a duplicate feed page"):
//  - Non-owner visitors are immediately router.replace'd to the House's
//    scoped feed (/feed?house=<id>) with NO intermediate screen — this
//    branch renders nothing itself.
//  - The House's owner sees this page: a working "View feed" link (the
//    same handoff a non-owner gets automatically) plus a manage-members
//    section.
//
// The manage-members section (U5) follows app/settings/privacy/page.tsx's
// confirmed real structural pattern — per-row pending-id during remove,
// filter-from-state-on-success, inline error banner, empty-state-via-
// conditional-subtitle — reused for its UI shape only, wired to this
// feature's own frontend/lib/api.ts functions (U2) and real
// backend/app/db.py tables, not to gatekept-api.ts. Adding a member uses
// app/search/page.tsx's debounced search-as-you-type pattern against the
// existing global search() endpoint — both branches (creators, videos)
// exactly as that endpoint exists today. Per KTD2a, the video-add search is
// deliberately NOT scoped to the owner's own uploads: any existing public
// video can be curated into a House regardless of who created it, matching
// the same global search a viewer would use on /search.
//
// Note on member-list state: there is no dedicated "list this House's
// members" endpoint (GET /houses only returns counts; GET /houses/{id}/feed
// returns the unioned video list with no per-item indication of whether a
// video arrived via creator-membership or individual video-membership).
// This page's Creators/Videos lists are therefore session-local: they start
// empty on load (nothing here claims to show a persisted roster) and grow/
// shrink only from this session's own add/remove actions, each of which is
// appended/filtered locally only *after* its API call succeeds (matching
// the confirmed "optimistic-after-success," not "optimistic-before-success"
// pattern). This is a real, deliberate scope boundary of U5's shipped
// surface, not an oversight — a "view current members" endpoint is exactly
// the kind of new backend surface U2 was frozen without, per this plan.
//
// Dynamic-route structure follows frontend/app/creators/[id]/page.tsx (the
// only existing [id]-dynamic-route precedent in this app): useParams for
// the segment, a fetch-in-effect, loading/error/not-found conditionals.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  listHouses,
  searchAll,
  addHouseCreatorMember,
  removeHouseCreatorMember,
  addHouseVideoMember,
  removeHouseVideoMember,
  type House,
  type SearchResult,
} from "@/lib/api";
import { getUser } from "@/lib/auth";

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "8px", padding: "9px 12px", fontSize: "13px",
  color: "var(--fg)", outline: "none", boxSizing: "border-box",
};

type MemberCreator = { id: string; name: string; department?: string };
type MemberVideo = { id: string; filename: string; creator_name?: string };

/**
 * One "Creators" or "Videos" add/remove section inside the manage-members
 * view. Generic over the member row shape so both sections share one
 * implementation of the settings/privacy pattern (per-row pending-id,
 * filter-from-state-on-success, inline error banner, debounced search-and-
 * add) rather than two near-duplicate blocks.
 */
function MemberSection<T extends { id: string }>({
  title,
  description,
  members,
  renderRow,
  searchResults,
  query,
  onQueryChange,
  searching,
  onAdd,
  onRemove,
  pendingRemoveId,
  error,
  emptyLabel,
}: {
  title: string;
  description: string;
  members: T[];
  renderRow: (m: T) => React.ReactNode;
  searchResults: { id: string; render: React.ReactNode }[];
  query: string;
  onQueryChange: (v: string) => void;
  searching: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  pendingRemoveId: string | null;
  error: string;
  emptyLabel: string;
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>{title}</h2>
      <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "14px" }}>{description}</p>

      {/* Search-as-you-type add box */}
      <div style={{ position: "relative", marginBottom: "14px" }}>
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search to add…"
          style={inputStyle}
        />
        {searching && (
          <div style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "3px" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: "4px", height: "4px", borderRadius: "50%", background: "var(--accent)",
                animation: `hmembers-pulse 1s ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
      </div>

      {query.trim() && !searching && searchResults.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
          {searchResults.map(r => (
            <button
              key={r.id}
              onClick={() => onAdd(r.id)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
                background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px",
                padding: "8px 12px", cursor: "pointer", textAlign: "left", width: "100%",
              }}
            >
              {r.render}
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}>+ Add</span>
            </button>
          ))}
        </div>
      )}

      {query.trim() && !searching && searchResults.length === 0 && (
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "16px" }}>No results for &ldquo;{query}&rdquo;</p>
      )}

      {error && (
        <p style={{ fontSize: "12px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "8px 10px", marginBottom: "12px" }}>
          {error}
        </p>
      )}

      {/* Current members */}
      {members.length === 0 ? (
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: 0 }}>{emptyLabel}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {members.map(m => (
            <div
              key={m.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "12px", padding: "8px 0", borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>{renderRow(m)}</span>
              <button
                onClick={() => onRemove(m.id)}
                disabled={pendingRemoveId === m.id}
                style={{
                  fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "999px",
                  border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)",
                  cursor: pendingRemoveId === m.id ? "not-allowed" : "pointer",
                  opacity: pendingRemoveId === m.id ? 0.6 : 1, flexShrink: 0,
                }}
              >
                {pendingRemoveId === m.id ? "…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [house, setHouse] = useState<House | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // null = not yet determined (still loading/resolving auth), so the
  // redirect effect below never fires prematurely on a viewer who is
  // actually the owner.
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  // ── Manage-members state (U5) ──────────────────────────────────────────
  // Session-local member lists — see this file's header comment for why
  // there is no "list current members" fetch to seed these from.
  const [creatorMembers, setCreatorMembers] = useState<MemberCreator[]>([]);
  const [videoMembers, setVideoMembers] = useState<MemberVideo[]>([]);
  const [creatorRemoveId, setCreatorRemoveId] = useState<string | null>(null);
  const [videoRemoveId, setVideoRemoveId] = useState<string | null>(null);
  const [creatorSectionError, setCreatorSectionError] = useState("");
  const [videoSectionError, setVideoSectionError] = useState("");

  const [creatorQuery, setCreatorQuery] = useState("");
  const [videoQuery, setVideoQuery] = useState("");
  const [creatorResults, setCreatorResults] = useState<SearchResult["creators"]>([]);
  const [videoResults, setVideoResults] = useState<SearchResult["videos"]>([]);
  const [searchingCreators, setSearchingCreators] = useState(false);
  const [searchingVideos, setSearchingVideos] = useState(false);
  const creatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced creator search — same 400ms pattern as app/search/page.tsx
  // and app/messages/compose/page.tsx. Reuses the existing global search()
  // endpoint (searchAll) exactly as /search does; no self-scoped filtering.
  // A blank query does nothing here (guarded, not cleared) — clearing
  // results for an empty query is a direct response to user input, handled
  // in handleCreatorQueryChange below instead of as a synchronous setState
  // at the top of the effect body, matching app/search/page.tsx's own
  // handleInput split exactly (avoids this repo's
  // react-hooks/set-state-in-effect rule).
  useEffect(() => {
    const trimmed = creatorQuery.trim();
    if (!trimmed) return;
    creatorTimerRef.current = setTimeout(async () => {
      setSearchingCreators(true);
      try {
        const data = await searchAll(trimmed);
        setCreatorResults(data.creators);
      } catch {
        setCreatorResults([]);
      } finally {
        setSearchingCreators(false);
      }
    }, 400);
    return () => { if (creatorTimerRef.current) clearTimeout(creatorTimerRef.current); };
  }, [creatorQuery]);

  // Debounced video search — per KTD2a, this is the SAME global search()
  // endpoint's video branch any viewer would get from /search, not a
  // self-scoped "my uploads only" list. A House owner can curate any
  // existing public video, regardless of who created it. See the creator
  // effect above for why the empty-query case isn't handled here.
  useEffect(() => {
    const trimmed = videoQuery.trim();
    if (!trimmed) return;
    videoTimerRef.current = setTimeout(async () => {
      setSearchingVideos(true);
      try {
        const data = await searchAll(trimmed);
        setVideoResults(data.videos);
      } catch {
        setVideoResults([]);
      } finally {
        setSearchingVideos(false);
      }
    }, 400);
    return () => { if (videoTimerRef.current) clearTimeout(videoTimerRef.current); };
  }, [videoQuery]);

  function handleCreatorQueryChange(val: string) {
    setCreatorQuery(val);
    if (!val.trim()) {
      if (creatorTimerRef.current) clearTimeout(creatorTimerRef.current);
      setCreatorResults([]);
    }
  }

  function handleVideoQueryChange(val: string) {
    setVideoQuery(val);
    if (!val.trim()) {
      if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
      setVideoResults([]);
    }
  }

  async function handleAddCreator(creatorId: string) {
    if (!id || creatorMembers.some(m => m.id === creatorId)) return;
    const found = creatorResults.find(c => c.id === creatorId);
    setCreatorSectionError("");
    try {
      await addHouseCreatorMember(id, creatorId);
      // Optimistic-AFTER-success (matches settings/privacy's confirmed
      // pattern): the row is only added to local state once the API call
      // has actually succeeded, not before.
      setCreatorMembers(prev => [
        ...prev,
        { id: creatorId, name: found?.name ?? creatorId, department: found?.department },
      ]);
      setCreatorQuery("");
      setCreatorResults([]);
    } catch {
      setCreatorSectionError("Could not add this creator. Try again.");
    }
  }

  async function handleRemoveCreator(creatorId: string) {
    if (!id) return;
    setCreatorRemoveId(creatorId);
    setCreatorSectionError("");
    try {
      await removeHouseCreatorMember(id, creatorId);
      setCreatorMembers(prev => prev.filter(m => m.id !== creatorId));
    } catch {
      setCreatorSectionError("Could not remove this creator. Try again.");
    } finally {
      setCreatorRemoveId(null);
    }
  }

  async function handleAddVideo(videoId: string) {
    if (!id || videoMembers.some(m => m.id === videoId)) return;
    const found = videoResults.find(v => v.id === videoId);
    setVideoSectionError("");
    try {
      await addHouseVideoMember(id, videoId);
      setVideoMembers(prev => [
        ...prev,
        { id: videoId, filename: found?.filename ?? videoId, creator_name: found?.creator_name },
      ]);
      setVideoQuery("");
      setVideoResults([]);
    } catch {
      setVideoSectionError("Could not add this video. Try again.");
    }
  }

  async function handleRemoveVideo(videoId: string) {
    if (!id) return;
    setVideoRemoveId(videoId);
    setVideoSectionError("");
    try {
      await removeHouseVideoMember(id, videoId);
      setVideoMembers(prev => prev.filter(m => m.id !== videoId));
    } catch {
      setVideoSectionError("Could not remove this video. Try again.");
    } finally {
      setVideoRemoveId(null);
    }
  }

  // Fetch the House so we know its owner_id (there is no dedicated
  // "get one House" endpoint — GET /houses already returns every custom
  // House with its owner_id, matching this unit's dependency on U2's real
  // shipped surface rather than inventing a new endpoint call here).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    listHouses()
      .then(data => {
        if (cancelled) return;
        const found = data.custom.find(h => h.id === id) ?? null;
        setHouse(found);
        if (!found) {
          setError("House not found");
          return;
        }
        const viewerId = getUser()?.id;
        setIsOwner(!!viewerId && viewerId === found.owner_id);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load this House");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // Non-owner handoff, per KTD7: redirect straight to the scoped feed with
  // no intermediate screen. Waits for `isOwner` to resolve (not null) and
  // for the House to have actually loaded, so a logged-out visitor or a
  // brief pre-auth-resolution window doesn't cause a flash redirect for
  // someone who turns out to be the owner.
  useEffect(() => {
    if (!id || loading || !house) return;
    if (isOwner === false) {
      router.replace(`/feed?house=${encodeURIComponent(id)}`);
    }
  }, [id, loading, house, isOwner, router]);

  if (loading || isOwner === null || isOwner === false) {
    // Covers: still loading, still resolving ownership, and the non-owner
    // window between isOwner resolving to false and the redirect effect
    // above committing — all of these render nothing, per KTD7's "no
    // intermediate screen" requirement.
    return null;
  }

  if (error || !house) {
    return (
      <div style={{ maxWidth: "520px", margin: "0 auto" }}>
        <div style={{ color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "10px", padding: "12px 16px", fontSize: "13px" }}>
          {error || "House not found"}
        </div>
      </div>
    );
  }

  // Owner view.
  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <Link
        href="/houses"
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
        Houses
      </Link>

      {/* Hero card */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "24px", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: house.description ? "12px" : 0 }}>
          <div style={{
            width: "56px", height: "56px", borderRadius: "50%", flexShrink: 0,
            background: "var(--accent)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: "22px", fontWeight: 700, color: "#fff",
          }}>
            {house.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "19px", fontWeight: 700, color: "var(--fg)", margin: 0 }}>{house.name}</h1>
              <span style={{
                fontSize: "11px", fontWeight: 600, padding: "2px 8px",
                borderRadius: "999px", background: "var(--accent-bg)",
                color: "var(--accent)", border: "1px solid var(--accent)",
              }}>
                YOUR HOUSE
              </span>
            </div>
          </div>
        </div>
        {house.description && (
          <p style={{ fontSize: "13px", color: "var(--fg-muted)", margin: 0 }}>{house.description}</p>
        )}
      </div>

      {/* View feed — the same handoff a non-owner gets automatically,
          exposed here as an explicit, working link for the owner. */}
      <Link
        href={`/feed?house=${encodeURIComponent(house.id)}`}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          width: "100%", boxSizing: "border-box",
          padding: "12px", fontSize: "14px", fontWeight: 600,
          background: "var(--accent)", color: "#fff",
          border: "none", borderRadius: "10px", textDecoration: "none",
          marginBottom: "16px",
        }}
      >
        View feed
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </Link>

      {/* Manage Members (U5) — two sections, Creators and Videos, each
          following settings/privacy's confirmed pattern. */}
      <style>{`
        @keyframes hmembers-pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <MemberSection<MemberCreator>
          title="Creators"
          description="Add a creator's entire catalog — present and future uploads — to this House."
          members={creatorMembers}
          renderRow={m => (
            <span style={{ fontSize: "13px", color: "var(--fg)" }}>
              <span style={{ fontWeight: 600 }}>{m.name}</span>
              {m.department && <span style={{ color: "var(--fg-muted)" }}> · {m.department}</span>}
            </span>
          )}
          searchResults={creatorResults
            .filter(c => !creatorMembers.some(m => m.id === c.id))
            .map(c => ({
              id: c.id,
              render: (
                <span style={{ fontSize: "13px", color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.department && <span style={{ color: "var(--fg-muted)" }}> · {c.department}</span>}
                </span>
              ),
            }))}
          query={creatorQuery}
          onQueryChange={handleCreatorQueryChange}
          searching={searchingCreators}
          onAdd={handleAddCreator}
          onRemove={handleRemoveCreator}
          pendingRemoveId={creatorRemoveId}
          error={creatorSectionError}
          emptyLabel="No creators added yet."
        />

        <MemberSection<MemberVideo>
          title="Videos"
          description="Add an individual video, from any creator — independent of who made it."
          members={videoMembers}
          renderRow={m => (
            <span style={{ fontSize: "13px", color: "var(--fg)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 600 }}>{m.filename.replace(/\.[^/.]+$/, "")}</span>
              {m.creator_name && <span style={{ color: "var(--fg-muted)" }}> · {m.creator_name}</span>}
            </span>
          )}
          searchResults={videoResults
            .filter(v => !videoMembers.some(m => m.id === v.id))
            .map(v => ({
              id: v.id,
              render: (
                <span style={{ fontSize: "13px", color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 600 }}>{v.filename.replace(/\.[^/.]+$/, "")}</span>
                  {v.creator_name && <span style={{ color: "var(--fg-muted)" }}> · {v.creator_name}</span>}
                </span>
              ),
            }))}
          query={videoQuery}
          onQueryChange={handleVideoQueryChange}
          searching={searchingVideos}
          onAdd={handleAddVideo}
          onRemove={handleRemoveVideo}
          pendingRemoveId={videoRemoveId}
          error={videoSectionError}
          emptyLabel="No videos added yet."
        />
      </div>
    </div>
  );
}
