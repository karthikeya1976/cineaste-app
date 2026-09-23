"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCreatorProfile, followCreator, unfollowCreator, type CreatorProfile } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

const chip: React.CSSProperties = {
  fontSize: "11px", fontWeight: 600, padding: "2px 8px",
  borderRadius: "999px", background: "var(--accent-bg)",
  color: "var(--accent)", border: "1px solid var(--accent)",
};

function StatBox({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)", margin: 0 }}>{value}</p>
      <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>{label}</p>
    </div>
  );
}

export default function CreatorProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [profile, setProfile]   = useState<CreatorProfile | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    getCreatorProfile(id)
      .then(p => {
        setProfile(p);
        setFollowing(p.is_following);
        setFollowerCount(p.follower_count);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function toggleFollow() {
    if (!isLoggedIn()) { router.push("/"); return; }
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setFollowerCount(c => wasFollowing ? c - 1 : c + 1);
    try {
      if (wasFollowing) await unfollowCreator(id);
      else              await followCreator(id);
    } catch {
      setFollowing(wasFollowing);
      setFollowerCount(c => wasFollowing ? c + 1 : c - 1);
    }
  }

  if (loading) return (
    <div style={{ color: "var(--fg-muted)", fontSize: "14px", paddingTop: "80px", textAlign: "center" }}>Loading…</div>
  );
  if (error || !profile) return (
    <div style={{ color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "10px", padding: "12px 16px", fontSize: "13px" }}>
      {error || "Creator not found"}
    </div>
  );

  const initials = profile.name.charAt(0).toUpperCase();

  return (
    <div style={{ maxWidth: "520px", margin: "0 auto" }}>

      {/* Back */}
      <button
        onClick={() => router.back()}
        style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", color: "var(--fg-muted)", fontSize: "13px", marginBottom: "20px", padding: 0 }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      {/* Hero card */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "28px 24px", marginBottom: "16px" }}>

        {/* Avatar + name row */}
        <div style={{ display: "flex", alignItems: "center", gap: "18px", marginBottom: "20px" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "50%", flexShrink: 0,
            background: "var(--accent)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "#fff",
          }}>{initials}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--fg)", margin: 0 }}>{profile.name}</h1>
              <span style={chip}>CREATOR</span>
            </div>
            {profile.department && (
              <p style={{ fontSize: "13px", color: "var(--fg-muted)", margin: "4px 0 0" }}>{profile.department}</p>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "16px 0", marginBottom: "20px", gap: "8px" }}>
          <StatBox value={followerCount} label="Followers" />
          <div style={{ width: "1px", background: "var(--border)" }} />
          <StatBox value={profile.video_count} label="Videos" />
          <div style={{ width: "1px", background: "var(--border)" }} />
          <StatBox value={profile.credits} label="Credits" />
        </div>

        {/* Enroute / Deroute + Message */}
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={toggleFollow}
            style={{
              flex: 1, padding: "10px", fontSize: "14px", fontWeight: 600,
              borderRadius: "10px", cursor: "pointer",
              background: following ? "transparent" : "var(--accent)",
              color: following ? "var(--fg-muted)" : "#fff",
              border: following ? "1px solid var(--border)" : "none",
              transition: "all 0.15s",
            }}
          >
            {following ? "Deroute" : "Enroute"}
          </button>
          <button
            onClick={() => {
              if (!isLoggedIn()) { router.push("/"); return; }
              router.push(`/messages/compose?to=${profile.id}&name=${encodeURIComponent(profile.name)}&type=${profile.account_type}`);
            }}
            style={{
              flex: 1, padding: "10px", fontSize: "14px", fontWeight: 600,
              borderRadius: "10px", cursor: "pointer",
              background: "transparent", color: "var(--fg)",
              border: "1px solid var(--border)",
            }}
          >
            Message
          </button>
        </div>
      </div>

      {/* About row */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "18px 20px" }}>
        <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>About</p>
        <p style={{ fontSize: "13px", color: "var(--fg-muted)", margin: 0 }}>
          {profile.department
            ? `${profile.name} is a filmmaker specialising in ${profile.department}.`
            : `${profile.name} is a filmmaker on Misence.`}
        </p>
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginTop: "10px", opacity: 0.6 }}>
          {profile.credits} credit{profile.credits !== 1 ? "s" : ""} earned from the community
        </p>
      </div>

    </div>
  );
}
