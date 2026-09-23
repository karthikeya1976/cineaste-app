"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upgradeToCreator } from "@/lib/api";
import { getUser, setAuth, getToken, clearAuth } from "@/lib/auth";
import {
  isPushSupported,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/gatekept-api";

// Standard film/TV production departments — department-head level (matches
// how crews are actually organized on a real call sheet), not individual job
// titles within a department (e.g. "Camera" here, not "1st AC"/"2nd AC"
// separately — keeping this list flat-select-friendly rather than needing a
// searchable/filterable picker). The original 9 entries are preserved
// verbatim and in their original relative order (any existing
// users.department value must keep matching exactly) with new department-
// level categories added around them; "Other" moved to the end as the
// catch-all it's meant to be.
//
// MUST be kept byte-for-byte in sync with backend/app/main.py's own
// DEPARTMENTS constant — the backend validates POST /auth/upgrade's
// department field against its copy (see that file's comment for why no
// single shared source exists yet).
const DEPARTMENTS = [
  "Cinematography", "Directing", "Screenwriting", "Editing",
  "Sound Design", "Visual Effects", "Production Design", "Acting",
  "Producing", "Camera", "Grip & Electric", "Art Department",
  "Set Decoration", "Costume Design", "Hair & Makeup", "Sound Recording",
  "Music", "Special Effects", "Stunts", "Casting", "Locations",
  "Production Management", "Script Supervision", "Continuity",
  "Colorist / Post-Production", "Animation", "Transportation",
  "Catering & Craft Services", "Other",
];

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "8px", padding: "10px 12px", fontSize: "14px",
  color: "var(--fg)", outline: "none",
};

export default function ProfilePage() {
  const router = useRouter();
  // getUser() reads localStorage, which doesn't exist during SSR. The
  // original approach here — useState(getUser) as a lazy initializer —
  // avoided an extra render, but ran getUser() during the render itself,
  // so the server always rendered as logged-out (user: null) while the
  // client's very first render saw the real, already-logged-in user. That
  // mismatch is React's hydration error #418 (https://react.dev/errors/418)
  // — confirmed via testing (present with this pattern, absent without it).
  //
  // Fix: useSyncExternalStore, same technique nav-bar.tsx already uses for
  // the identical bug — its getServerSnapshot always returns the SSR-safe
  // default (null), so the initial client render matches the server
  // exactly; the real value only takes effect on the next tick, as an
  // ordinary post-hydration update rather than a mismatch, and without a
  // bare setState-in-effect (this repo's lint blocks that pattern — see
  // the CI changelog entry that already eliminated it project-wide).
  //
  // This ONLY works because getUser() (lib/auth.ts) was changed alongside
  // this fix to cache its result by reference — useSyncExternalStore
  // requires getSnapshot to return a referentially-stable (===) value
  // when nothing actually changed, and getUser()'s original
  // JSON.parse-every-call implementation returned a new object every
  // single call, which read as "changed every render" and caused a real
  // infinite-render-loop crash ("Maximum update depth exceeded"),
  // confirmed via testing before the auth.ts fix. Do not swap getUser()
  // back to a non-memoized implementation without re-checking this.
  //
  // No separate useState for `user` — tried that (twice), both attempts
  // broke: (1) a lazy initializer only seeds once at true mount, so it
  // never picks up the real value after hydration; (2) a sync-into-state
  // effect (even guarded by an inequality check) still trips this repo's
  // react-hooks/set-state-in-effect lint rule, which flags ANY
  // synchronous setState call inside an effect body, guarded or not.
  // `syncedUser` is used directly everywhere instead — after
  // handleUpgrade's setAuth() call, the setSuccess/setUpgrading calls
  // that follow it in the same handler already trigger a re-render, and
  // useSyncExternalStore re-evaluates getSnapshot (getUser) on every
  // render regardless of what triggered it, so the upgraded user shows up
  // immediately with no extra state or explicit re-read needed.
  const noopSubscribe = () => () => {};
  const user = useSyncExternalStore(noopSubscribe, getUser, () => null);
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

  // Redirecting is a real side effect (navigation), so it stays in an
  // effect — only the state read above moved out. Delayed by one
  // setTimeout(0) tick rather than checked immediately: `user`
  // (useSyncExternalStore, above) can render as null for a render or two
  // immediately after hydration before settling on the real value —
  // confirmed via direct instrumentation (logging on every check showed
  // null, then the real user, both within the SAME effect-commit flush —
  // a ref-based "have we mounted" flag does NOT help here, tried and
  // confirmed still broken, because the flag is already true by the time
  // this very first check runs; there is no separate "mounted" moment to
  // gate on that arrives before user resolves). Apparently React 19
  // Strict Mode's intentional dev-mode double-invoke (mount → simulated
  // unmount → remount) racing against this specific external-store read.
  // That's invisible for something like nav-bar.tsx's use of the same
  // useSyncExternalStore technique (it only changes what renders, which
  // is naturally idempotent across those extra renders), but genuinely
  // broke here: this effect performs navigation, a real side effect that
  // does NOT undo itself once a later render disagrees — checking
  // immediately fired on the transient null and the app was already
  // mid-navigation (to "/", which itself immediately redirects an
  // already-logged-in visitor to "/feed" — see app/page.tsx) by the time
  // the real user value arrived.
  //
  // A macrotask (setTimeout) defers the check past the synchronous
  // render-and-effect-flush sequence entirely, onto its own event-loop
  // turn — by then, React has settled on user's real, stable value
  // (confirmed via testing: the timeout callback below reads the correct
  // final value on every run). The timer is cleared on cleanup so a
  // fast unmount (navigating away before the timeout fires) can't still
  // redirect afterward.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!user) router.replace("/");
    }, 0);
    return () => clearTimeout(timer);
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
      // No setUser(getUser()) call needed here — `user` is derived
      // directly from useSyncExternalStore now (see its own comment
      // above); the setSuccess/setUpgrading state changes below already
      // trigger a re-render, which re-evaluates the synced snapshot and
      // picks up this setAuth() write automatically.
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
            {success && <p style={{ fontSize: "13px", color: "#e08a5f", background: "#c2542322", border: "1px solid #c2542344", borderRadius: "8px", padding: "10px 12px" }}>{success}</p>}

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
