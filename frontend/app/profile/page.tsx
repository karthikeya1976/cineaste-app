"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upgradeToCreator } from "@/lib/api";
import { getUser, setAuth, getToken, clearAuth, type AuthUser } from "@/lib/auth";
import {
  isPushSupported,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/gatekept-api";

const DEPARTMENTS = [
  "Cinematography", "Directing", "Screenwriting", "Editing",
  "Sound Design", "Visual Effects", "Production Design", "Acting", "Other",
];

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "8px", padding: "10px 12px", fontSize: "14px",
  color: "var(--fg)", outline: "none",
};

export default function ProfilePage() {
  const router = useRouter();
  // getUser() is synchronous (reads localStorage) — compute the initial
  // value lazily instead of via setState-in-effect, avoiding an extra render.
  const [user, setUser]           = useState<AuthUser | null>(getUser);
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");

  // issue #24 / U5: minimal push-notification toggle. `pushSubscriptionId`
  // doubles as both "are we currently subscribed" (non-null) and the id
  // needed to call unsubscribeFromPush — the browser's own
  // PushSubscription object carries no backend row id of its own, so this
  // is the only place that id lives client-side (not persisted across
  // reloads by design; re-checking getExistingPushSubscription() on mount
  // only tells us the browser thinks it's subscribed, not the backend row
  // id — see the effect below for how that's reconciled).
  // Computed lazily as initial state (isPushSupported() is synchronous, same
  // as getUser() above) rather than set from inside the effect below — a
  // synchronous setState call as the first line of an effect body trips
  // this codebase's react-hooks/set-state-in-effect lint rule, and there's
  // no need for it here since the value never changes after mount.
  const [pushSupported] = useState(isPushSupported);
  const [pushSubscriptionId, setPushSubscriptionId] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  // Redirecting is a real side effect (navigation), so it stays in an effect —
  // only the state read above moved out.
  useEffect(() => {
    if (!user) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (!pushSupported) return;
    // Reflects whether the BROWSER already has an active subscription
    // (e.g. from a previous session) so the toggle doesn't show "Enable"
    // for a user who's already subscribed. The browser's PushSubscription
    // object carries no backend row id of its own, so a real id is
    // recovered by re-running subscribeToPush() — POST
    // /v1/push-subscriptions is an ON CONFLICT upsert keyed on
    // (user_id, endpoint) (db/pushSubscriptions.ts), so re-subscribing an
    // already-active browser subscription is a no-op against the push
    // service itself and simply returns the existing row's real id. A
    // placeholder id here would break unsubscribeFromPush: the DELETE
    // route's id param is cast straight to the push_subscriptions.id
    // BIGSERIAL column, so a non-numeric placeholder raises a Postgres
    // type error (500), not the 404 that function is written to treat as
    // success.
    getExistingPushSubscription().then((sub) => {
      if (!sub) return;
      subscribeToPush()
        .then(({ id }) => setPushSubscriptionId(id))
        .catch(() => {
          // Best-effort reconciliation only — if this fails, the toggle
          // falls back to showing "Enable" and a fresh subscribeToPush()
          // click still works normally.
        });
    });
  }, [pushSupported]);

  async function handleTogglePush() {
    setPushError("");
    setPushBusy(true);
    try {
      if (pushSubscriptionId) {
        await unsubscribeFromPush(pushSubscriptionId);
        setPushSubscriptionId(null);
      } else {
        const { id } = await subscribeToPush();
        setPushSubscriptionId(id);
      }
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : "Failed to update push notifications");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleUpgrade(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess(""); setUpgrading(true);
    try {
      const { user: updated } = await upgradeToCreator(department);
      const token = getToken()!;
      setAuth(token, {
        id: updated.id, name: updated.name ?? user?.name ?? "",
        email: updated.email ?? user?.email ?? "",
        account_type: updated.account_type, department: updated.department,
      });
      setUser(getUser());
      setSuccess("Upgraded to Creator! You can now upload showreels.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upgrade failed");
    } finally {
      setUpgrading(false);
    }
  }

  if (!user) return null;

  const isCreator = user.account_type === "creator";

  return (
    <div style={{ maxWidth: "440px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)", marginBottom: "24px" }}>Profile</h1>

      {/* User card */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
          <div style={{
            width: "48px", height: "48px", borderRadius: "50%",
            background: "var(--accent)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "20px", fontWeight: 700,
          }}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p style={{ fontWeight: 600, color: "var(--fg)" }}>{user.name}</p>
            <p style={{ fontSize: "13px", color: "var(--fg-muted)" }}>{user.email}</p>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: "var(--fg-muted)" }}>Account type</span>
          <span style={{
            fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "999px",
            background: isCreator ? "var(--accent-bg)" : "var(--bg)",
            color: isCreator ? "var(--accent)" : "var(--fg-muted)",
            border: `1px solid ${isCreator ? "var(--accent)" : "var(--border)"}`,
          }}>
            {isCreator ? "Creator" : "Viewer"}
          </span>
        </div>

        {user.department && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", marginTop: "12px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "13px", color: "var(--fg-muted)" }}>Department</span>
            <span style={{ fontSize: "13px", color: "var(--fg)" }}>{user.department}</span>
          </div>
        )}
      </div>

      {/* Upgrade section */}
      {!isCreator && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: "14px", padding: "24px", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--accent)", marginBottom: "6px" }}>Become a Creator</h2>
          <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginBottom: "18px" }}>
            Upload showreels and share your filmmaking work with the community.
          </p>

          <form onSubmit={handleUpgrade} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "6px" }}>
                Your filmmaking department
              </label>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {DEPARTMENTS.map(d => <option key={d} style={{ background: "var(--bg)" }}>{d}</option>)}
              </select>
            </div>

            {error   && <p style={{ fontSize: "13px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "10px 12px" }}>{error}</p>}
            {success && <p style={{ fontSize: "13px", color: "#7ba3ff", background: "#4169e122", border: "1px solid #4169e144", borderRadius: "8px", padding: "10px 12px" }}>{success}</p>}

            <button
              type="submit" disabled={upgrading}
              style={{
                width: "100%", padding: "10px", fontSize: "14px", fontWeight: 600,
                background: "var(--accent)", color: "#fff", border: "none",
                borderRadius: "8px", cursor: upgrading ? "not-allowed" : "pointer",
                opacity: upgrading ? 0.6 : 1,
              }}
            >
              {upgrading ? "Upgrading…" : "Upgrade to Creator"}
            </button>
          </form>
        </div>
      )}

      {/* Settings */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>Settings</h2>
        <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "16px" }}>Account preferences and controls</p>

        {/* issue #24 / U5: Web Push toggle — a real, working control (not
            a "Soon" placeholder like the rows below it). Only rendered
            when this browser/environment actually supports the Push API
            and a VAPID public key is configured (see gatekept-api.ts's
            isPushSupported()). */}
        {pushSupported && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 0", borderBottom: "1px solid var(--border)",
          }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--fg)", margin: 0 }}>Push notifications</p>
              <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>
                Browser alerts for new Gatekept messages and message requests
              </p>
              {pushError && (
                <p style={{ fontSize: "11px", color: "#f87171", margin: "6px 0 0" }}>{pushError}</p>
              )}
            </div>
            <button
              onClick={handleTogglePush}
              disabled={pushBusy}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "6px 14px", borderRadius: "999px",
                border: `1px solid ${pushSubscriptionId ? "var(--accent)" : "var(--border)"}`,
                background: pushSubscriptionId ? "var(--accent-bg)" : "var(--bg)",
                color: pushSubscriptionId ? "var(--accent)" : "var(--fg-muted)",
                cursor: pushBusy ? "not-allowed" : "pointer",
                opacity: pushBusy ? 0.6 : 1,
                flexShrink: 0, marginLeft: "12px",
              }}
            >
              {pushBusy ? "…" : pushSubscriptionId ? "Enabled" : "Enable"}
            </button>
          </div>
        )}

        {/* Privacy is a real page now (blocked-users list) — no longer a
            "Soon" placeholder like the two rows below it. */}
        <Link
          href="/settings/privacy"
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 0", borderBottom: "1px solid var(--border)",
            textDecoration: "none", cursor: "pointer",
          }}
        >
          <div>
            <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--fg)", margin: 0 }}>Privacy</p>
            <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>Manage who you&apos;ve blocked</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2" style={{ flexShrink: 0, marginLeft: "12px" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>

        {[
          { label: "Notifications", desc: "Email alerts for new followers and credits" },
          { label: "Account", desc: "Change password or delete your account" },
        ].map((s, i, arr) => (
          <div key={s.label} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 0",
            borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--fg)", margin: 0 }}>{s.label}</p>
              <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0" }}>{s.desc}</p>
            </div>
            <span style={{
              fontSize: "11px", color: "var(--fg-muted)", background: "var(--bg)",
              border: "1px solid var(--border)", borderRadius: "999px", padding: "2px 10px",
              flexShrink: 0, marginLeft: "12px",
            }}>Soon</span>
          </div>
        ))}
      </div>

      {/* Logout */}
      <button
        onClick={() => { clearAuth(); router.push("/"); }}
        style={{
          width: "100%", padding: "10px", fontSize: "14px", fontWeight: 500,
          background: "transparent", color: "var(--fg-muted)",
          border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer",
        }}
      >
        Log out
      </button>
    </div>
  );
}
