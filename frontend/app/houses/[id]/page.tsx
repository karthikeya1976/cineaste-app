"use client";

// Custom House detail route — Houses navigation feature (U4).
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
// SCOPE BOUNDARY (U4 vs U5): the manage-members section below is a clearly
// labeled placeholder/skeleton ONLY. Implementation Unit U5 (a separate,
// not-yet-started unit) will build the real creator/video search-and-add
// and per-row remove interaction inside this same file. Building that here
// would conflict with U5's work later — do not add real add/remove UI to
// this file outside of U5.
//
// Dynamic-route structure follows frontend/app/creators/[id]/page.tsx (the
// only existing [id]-dynamic-route precedent in this app): useParams for
// the segment, a fetch-in-effect, loading/error/not-found conditionals.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { listHouses, type House } from "@/lib/api";
import { getUser } from "@/lib/auth";

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

      {/* Manage Members — PLACEHOLDER SKELETON ONLY.
          Real add/remove creator/video UI is Implementation Unit U5's
          scope, built inside this same section once this PR merges. This
          block intentionally stops at a labeled "coming soon" skeleton so
          U5's work has nothing here to conflict with. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>Manage Members</h2>
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "18px" }}>
          Add creators and videos to curate this House
        </p>

        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
          gap: "6px", padding: "28px 16px",
          border: "1px dashed var(--border)", borderRadius: "10px",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" style={{ opacity: 0.5, marginBottom: "4px" }}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)", margin: 0 }}>Coming soon</p>
          <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: 0, maxWidth: "320px" }}>
            Searching for creators and videos to add — and removing existing members — will be available here shortly.
          </p>
        </div>
      </div>
    </div>
  );
}
