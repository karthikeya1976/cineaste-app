"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { setAuth, isLoggedIn } from "@/lib/auth";
import { ensureRegistered } from "@/lib/gatekept-api";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode]       = useState<"login" | "register">("login");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) router.replace("/feed");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        const { user } = await register(name, email, password);
        const { access_token } = await login(email, password);
        setAuth(access_token, user);
      } else {
        const { access_token } = await login(email, password);
        const payload = JSON.parse(atob(access_token.split(".")[1]));
        setAuth(access_token, {
          id: payload.sub,
          name: email.split("@")[0],
          email,
          account_type: "viewer",
        });
      }
      // Register this account's (placeholder) Gatekept key material right
      // after auth succeeds — not only when the user happens to open
      // Messages. Otherwise a sender can only ever message someone who has
      // already opened Messages themselves at least once, since a
      // recipient must have a Gatekept-side row before anyone can look up
      // their prekey bundle (see lib/gatekept-api.ts's ensureRegistered).
      // Fire-and-forget: Gatekept being unreachable shouldn't block login.
      void ensureRegistered().catch(() => {});
      router.push("/feed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "14px",
    color: "var(--fg)",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: "360px" }}>

        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.5px" }}>
            Misence
          </h1>
          <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>
            We only talk about movies here.
          </p>
        </div>

        {/* Card */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px" }}>

          {/* Tab toggle */}
          <div style={{ display: "flex", background: "var(--bg)", borderRadius: "8px", padding: "4px", marginBottom: "24px" }}>
            {(["login", "register"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: "8px", fontSize: "13px", fontWeight: 500,
                  borderRadius: "6px", border: "none", cursor: "pointer",
                  background: mode === m ? "var(--accent)" : "transparent",
                  color: mode === m ? "#fff" : "var(--fg-muted)",
                  transition: "all 0.15s",
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {mode === "register" && (
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "6px" }}>Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required style={inputStyle} placeholder="Your name" />
              </div>
            )}
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "6px" }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} placeholder="you@example.com" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--fg-muted)", marginBottom: "6px" }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} style={inputStyle} placeholder="Min 8 characters" />
            </div>

            {error && (
              <p style={{ fontSize: "13px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "10px 12px" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", padding: "10px", fontSize: "14px", fontWeight: 600,
                background: "var(--accent)", color: "#fff", border: "none",
                borderRadius: "8px", cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1, transition: "opacity 0.15s",
              }}
            >
              {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
