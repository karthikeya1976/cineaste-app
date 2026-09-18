"use client";

// Find-people search — adapted from gatekept/web/app/search/page.tsx.
//
// Rewritten, not copied: the source called the now-deleted handle-keyed
// getPreKeyBundle(profile.handle) and searched Gatekept's own handle
// directory (findUserByHandle). Gatekept's backend has no handle-keyed
// routes at all anymore — this uses Editor Club's /search-users (all
// account_types, not just creators) for lookup and the ID-keyed
// GET /keys/:userId/bundle for the prekey fetch.

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  searchUsers,
  getPreKeyBundle,
  getScannerBundle,
  sendChatRequest,
  ensureRegistered,
  ApiError,
  type DirectoryUser,
} from "@/lib/gatekept-api";
import { placeholderEncrypt } from "@/lib/gatekept-crypto";
import { CryptoNotice } from "@/components/CryptoNotice";
import { MessagesNavTabs } from "@/components/MessagesNavTabs";
import { getUser, isLoggedIn } from "@/lib/auth";

type Step = "idle" | "found" | "sent";

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "12px", padding: "12px 14px", fontSize: "14px",
  color: "var(--fg)", outline: "none", boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 18px", fontSize: "14px", fontWeight: 600,
  background: "var(--accent)", color: "#fff", border: "none",
  borderRadius: "8px", cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 18px", fontSize: "14px", fontWeight: 500,
  background: "transparent", color: "var(--fg-muted)",
  border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer",
};

// useSearchParams requires a Suspense boundary in the App Router — this
// page has no other reason to suspend, but the hook itself does during
// the initial static shell render.
export default function MessagesSearchPage() {
  return (
    <Suspense fallback={null}>
      <MessagesSearchPageInner />
    </Suspense>
  );
}

function MessagesSearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep-link entry point: another page (e.g. a creator's profile, via its
  // Message button) can jump straight into composing to a known user —
  // ?to=<id>&name=<name>&type=<account_type> — skipping the search step
  // entirely, rather than making the sender re-find someone they already
  // found once. Computed once as the initial state (not in an effect —
  // there's no actual side effect here, just deriving day-one state from
  // the URL, which react-hooks' set-state-in-effect rule correctly steers
  // away from an effect for; same principle as app/profile/page.tsx's own
  // "state read, not fetched" comment).
  const deepLinkTarget = (): DirectoryUser | null => {
    const to = searchParams.get("to");
    const name = searchParams.get("name");
    if (!to || !name) return null;
    return { id: to, name, account_type: searchParams.get("type") ?? "" };
  };

  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>(() => (deepLinkTarget() ? "found" : "idle"));
  const [target, setTarget] = useState<DirectoryUser | null>(deepLinkTarget);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const me = getUser();

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/");
      return;
    }
    // Register this user's (placeholder) key material on Gatekept the
    // first time they touch messaging in this browser session — see
    // ensureRegistered()'s own comment for why this was missing entirely
    // and what it broke (every real account 404'd as "User" not found,
    // both when messaging someone and when being messaged).
    void ensureRegistered().catch(() => {
      // A failed registration surfaces naturally when a real action (send,
      // bundle fetch) needs it and fails — no need to block or error the
      // page just for arriving on it.
    });
  }, [router]);

  // Debounced search: fires 400ms after the user stops typing, same pattern
  // as app/search/page.tsx.
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) return;
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const found = await searchUsers(trimmed);
        setResults(found.filter((u) => u.id !== me?.id));
      } catch {
        setError("Could not reach search — check your connection.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [q, me?.id]);

  function handleInput(val: string) {
    setQ(val);
    if (!val.trim()) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setResults(null);
      setError("");
    }
  }

  function selectTarget(user: DirectoryUser) {
    setTarget(user);
    setDraft("");
    setError("");
    setStep("found");
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError("");
    setSending(true);

    try {
      // Two separate "encryptions" (placeholder — see lib/gatekept-crypto.ts):
      // one shape-compatible copy for the recipient, one for the scanner. In
      // a real client these would be genuinely different X3DH sessions
      // against two different key bundles.
      const [recipientBundle, scannerBundle] = await Promise.all([
        getPreKeyBundle(target.id),
        getScannerBundle(),
      ]);
      void recipientBundle;
      void scannerBundle;

      const forRecipient = placeholderEncrypt(draft);
      const forScanner = placeholderEncrypt(draft);

      await sendChatRequest({
        recipientId: target.id,
        recipientCiphertext: forRecipient.ciphertext,
        recipientCiphertextType: forRecipient.type,
        scannerCiphertext: forScanner.ciphertext,
        senderRegistrationId: Math.floor(Math.random() * 16384),
        senderDeviceId: 1,
      });

      setStep("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--fg)" }}>Messages</h1>
        <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "4px" }}>
          You can send one message. They decide whether to open a conversation.
        </p>
      </div>

      <MessagesNavTabs />

      {step === "idle" && (
        <>
          {/* Search input */}
          <div style={{ position: "relative", marginBottom: "24px" }}>
            <svg style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--fg-muted)", pointerEvents: "none" }}
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={q}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="Search people by name…"
              autoFocus
              style={{ ...inputStyle, paddingLeft: "42px", paddingRight: "42px" }}
            />
            {q && !loading && (
              <button onClick={() => handleInput("")} style={{
                position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "var(--fg-muted)",
                fontSize: "18px", lineHeight: 1, padding: "2px 4px",
              }}>×</button>
            )}
            {loading && (
              <div style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "3px" }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)",
                    animation: `msg-pulse 1s ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            )}
          </div>

          <style>{`
            @keyframes msg-pulse {
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
              <p style={{ fontSize: "14px", fontWeight: 500 }}>Find people to message</p>
              <p style={{ fontSize: "12px", marginTop: "6px", opacity: 0.6 }}>
                Search any Editor Club member by name — viewers and creators
              </p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#7f1d1d22", border: "1px solid #7f1d1d55", fontSize: "13px", color: "#f87171", marginBottom: "16px" }}>
              {error}
            </div>
          )}

          {/* No results state */}
          {q && !loading && !error && results && results.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "48px", color: "var(--fg-muted)" }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                style={{ margin: "0 auto 10px", display: "block", opacity: 0.35 }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="8" y1="8" x2="14" y2="14" strokeWidth="2"/><line x1="14" y1="8" x2="8" y2="14" strokeWidth="2"/>
              </svg>
              <p style={{ fontSize: "14px", fontWeight: 500 }}>No one found for &ldquo;{q}&rdquo;</p>
              <p style={{ fontSize: "12px", marginTop: "6px", opacity: 0.6 }}>Try a shorter word or check the spelling</p>
            </div>
          )}

          {/* Results */}
          {results && results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => selectTarget(u)}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: "12px", padding: "14px 16px",
                    display: "flex", alignItems: "center", gap: "14px",
                    cursor: "pointer", textAlign: "left", width: "100%",
                  }}
                >
                  <div style={{
                    width: "44px", height: "44px", borderRadius: "50%", flexShrink: 0,
                    background: "var(--accent)", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "#fff",
                  }}>{u.name.charAt(0).toUpperCase()}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--fg)", margin: 0 }}>{u.name}</p>
                    <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0", textTransform: "capitalize" }}>
                      {u.account_type}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === "found" && target && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: "15px", color: "var(--fg)", margin: 0 }}>{target.name}</p>
            <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: "2px 0 0", textTransform: "capitalize" }}>{target.account_type}</p>
          </div>

          <form onSubmit={handleSend} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Say why you're reaching out — this is the only message you get until they accept."
              rows={4}
              maxLength={2000}
              required
              autoFocus
              style={{ ...inputStyle, resize: "none" }}
            />
            <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: 0 }}>No photos or videos on a first message — text only.</p>
            <CryptoNotice compact />

            {error && (
              <p style={{ fontSize: "13px", color: "#f87171", background: "#7f1d1d22", border: "1px solid #7f1d1d55", borderRadius: "8px", padding: "10px 12px", margin: 0 }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <button type="submit" disabled={sending || !draft.trim()} style={{ ...btnPrimary, opacity: sending || !draft.trim() ? 0.6 : 1 }}>
                {sending ? "Sending…" : "Send message"}
              </button>
              <button
                type="button"
                onClick={() => { setStep("idle"); setTarget(null); setDraft(""); setError(""); }}
                style={btnSecondary}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "sent" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ fontWeight: 600, color: "var(--fg)", margin: 0 }}>Message sent.</p>
          <p style={{ fontSize: "13px", color: "var(--fg-muted)", margin: 0 }}>
            If it reaches {target?.name}, they&apos;ll see a request to open a
            conversation. You won&apos;t be notified either way until they accept.
          </p>
          <button onClick={() => router.push("/messages/requests")} style={{ ...btnSecondary, alignSelf: "center", marginTop: "8px" }}>
            Back to requests
          </button>
        </div>
      )}
    </div>
  );
}
