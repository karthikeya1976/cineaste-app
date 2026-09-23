"use client";

// Houses listing page — Houses navigation feature (U4).
//
// Two kinds of House, per docs/plans/2026-09-22-001-feat-houses-navigation-plan.md:
//  - Built-in Houses (one per department, no id/table — derived from
//    `DEPARTMENTS`, listed here under "builtIn"). Tapping one navigates
//    straight to the House-scoped feed via the "department:<name>" house
//    param convention (KTD7/parseHouseParam).
//  - Custom Houses (owned, curated entities with real rows). Tapping one
//    navigates to /houses/[id], a thin owner/non-owner branch (see that
//    page) rather than straight to the feed.
//
// Visual shape follows frontend/app/search/page.tsx's card-list precedent
// (surface/border card rows, chip badges, consistent spacing) rather than
// inventing a new layout language for this page.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listHouses, createHouse, type House, type HousesListResponse } from "@/lib/api";
import { formatHouseMemberCount } from "@/lib/houses";
import { isLoggedIn, isCreator } from "@/lib/auth";

const cardStyle: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "12px", padding: "14px 16px",
  display: "flex", alignItems: "center", gap: "14px",
  cursor: "pointer", textAlign: "left", width: "100%",
};

const iconTileStyle: React.CSSProperties = {
  width: "44px", height: "44px", borderRadius: "10px", flexShrink: 0,
  background: "var(--bg)", border: "1px solid var(--border)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "8px", padding: "10px 12px", fontSize: "14px",
  color: "var(--fg)", outline: "none", boxSizing: "border-box",
};

function BuildingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2">
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
    </svg>
  );
}

export default function HousesPage() {
  const router = useRouter();
  const [data, setData] = useState<HousesListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    listHouses()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Could not load Houses"))
      .finally(() => setLoading(false));
  }, []);

  function goToDepartment(deptName: string) {
    router.push(`/feed?house=${encodeURIComponent(`department:${deptName}`)}`);
  }

  function goToCustomHouse(house: House) {
    router.push(`/houses/${house.id}`);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const house = await createHouse(name.trim(), description.trim() || undefined);
      // Navigate straight to the new House's manage-members view so the
      // owner can immediately add members — an empty House with no way to
      // populate it would be a dead end (per U4's Approach).
      router.push(`/houses/${house.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create House");
      setCreating(false);
    }
  }

  const showCreateAffordance = isLoggedIn() && isCreator();

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Houses</h1>
          <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>
            Browse by department, or explore curated collections
          </p>
        </div>
        {showCreateAffordance && (
          <button
            onClick={() => setShowCreate(s => !s)}
            style={{
              fontSize: "13px", fontWeight: 600, padding: "8px 16px", borderRadius: "999px",
              cursor: "pointer", flexShrink: 0,
              background: showCreate ? "transparent" : "var(--accent)",
              color: showCreate ? "var(--fg-muted)" : "#fff",
              border: showCreate ? "1px solid var(--border)" : "none",
            }}
          >
            {showCreate ? "Cancel" : "Create a House"}
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateAffordance && showCreate && (
        <form
          onSubmit={handleCreate}
          style={{
            background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: "14px",
            padding: "20px", marginBottom: "24px", display: "flex", flexDirection: "column", gap: "12px",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "6px" }}>
              House name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Best of Sound Design"
              style={inputStyle}
              autoFocus
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "6px" }}>
              Description <span style={{ opacity: 0.6 }}>(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What's this House about?"
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
          {createError && (
            <p style={{ fontSize: "13px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "10px 12px", margin: 0 }}>
              {createError}
            </p>
          )}
          <button
            type="submit"
            disabled={creating}
            style={{
              padding: "10px", fontSize: "14px", fontWeight: 600,
              background: "var(--accent)", color: "#fff", border: "none",
              borderRadius: "8px", cursor: creating ? "not-allowed" : "pointer",
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? "Creating…" : "Create House"}
          </button>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", paddingTop: "48px", color: "var(--fg-muted)" }}>
          <p style={{ fontSize: "14px" }}>Loading…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#7f1d1d22", border: "1px solid #7f1d1d55", fontSize: "13px", color: "#f87171", marginBottom: "16px" }}>
          Could not load Houses — check your connection. ({error})
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Departments section */}
          {data.builtIn.length > 0 && (
            <div style={{ marginBottom: "28px" }}>
              <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
                Departments
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.builtIn.map(dept => (
                  <button key={dept.name} style={cardStyle} onClick={() => goToDepartment(dept.name)}>
                    <div style={iconTileStyle}>
                      <BuildingIcon />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--fg)", margin: 0 }}>
                        {dept.name}
                      </p>
                      <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>
                        Every approved video in this department
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom Houses section */}
          <div>
            <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
              Custom Houses
            </p>
            {data.custom.length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: "24px", paddingBottom: "24px", color: "var(--fg-muted)" }}>
                <p style={{ fontSize: "13px" }}>No custom Houses yet.</p>
                {showCreateAffordance && (
                  <p style={{ fontSize: "12px", marginTop: "4px", opacity: 0.6 }}>
                    Create one to start curating a collection.
                  </p>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.custom.map(house => (
                  <button key={house.id} style={cardStyle} onClick={() => goToCustomHouse(house)}>
                    <div style={{
                      width: "44px", height: "44px", borderRadius: "50%", flexShrink: 0,
                      background: "var(--accent)", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "#fff",
                    }}>
                      {house.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontWeight: 600, fontSize: "14px", color: "var(--fg)", margin: 0,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {house.name}
                      </p>
                      <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>
                        {formatHouseMemberCount(house.creator_count ?? 0, house.video_count ?? 0)}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
