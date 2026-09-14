// ── Placeholder crypto layer ──────────────────────────────────────────────
//
// HONEST STATUS: this file does NOT implement real Signal Protocol
// encryption. The backend's crypto (backend/src/crypto/, verified against
// @signalapp/libsignal-client) is real and tested — but that library ships
// only native Node bindings (.node files per OS/arch), with no official
// WASM build. A browser cannot load it.
//
// Building a real browser-compatible implementation requires compiling
// Signal's Rust core to wasm32, which needs a Rust toolchain and a
// nontrivial cross-compilation effort — tracked as follow-up work, not
// done in this build. See gatekept/docs/gaps.md.
//
// What this file does instead: generates plausible-shaped key material and
// "ciphertext" so every other part of the system (the gate, the API
// contracts, the UI, blocking, reporting) can be built and demonstrated
// against the REAL backend, honestly labeled as not-yet-encrypted rather
// than silently faked as secure.
//
// Every function here is named and commented to make this unmistakable at
// every call site — nothing in this file should ever be mistaken for real
// E2EE, and the UI surfaces a visible banner (see components/CryptoNotice.tsx)
// wherever it matters.

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Shape-compatible fake key bundle for registration. Real sizes (33 bytes
 *  for Curve25519 public keys, 64 for signatures) so the backend's storage
 *  and API contracts are exercised realistically, even though the bytes
 *  are not cryptographically meaningful. */
export interface FakeIdentityBundle {
  identityPubkey: string;
  registrationId: number;
  signedPreKeyId: number;
  signedPreKeyPub: string;
  signedPreKeySig: string;
  kyberPreKeyId: number;
  kyberPreKeyPub: string;
  kyberPreKeySig: string;
  oneTimePreKeys: Array<{ id: number; publicKey: string }>;
}

export function generatePlaceholderIdentity(): FakeIdentityBundle {
  return {
    identityPubkey: toBase64(randomBytes(33)),
    registrationId: Math.floor(Math.random() * 16384),
    signedPreKeyId: 1,
    signedPreKeyPub: toBase64(randomBytes(33)),
    signedPreKeySig: toBase64(randomBytes(64)),
    kyberPreKeyId: 1,
    kyberPreKeyPub: toBase64(randomBytes(1568)), // real Kyber-1024 pubkey size
    kyberPreKeySig: toBase64(randomBytes(64)),
    oneTimePreKeys: Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      publicKey: toBase64(randomBytes(33)),
    })),
  };
}

/**
 * PLACEHOLDER — does not encrypt anything. Wraps the plaintext in a
 * recognizable marker and base64-encodes it, so it round-trips through the
 * backend's ciphertext columns correctly (proving the relay/storage path
 * works) while being trivially identifiable as non-encrypted in a DB dump
 * or on the wire — deliberately not disguised as real ciphertext.
 */
export function placeholderEncrypt(plaintext: string): { ciphertext: string; type: "prekey" | "whisper" } {
  const marker = `GATEKEPT_PLACEHOLDER_NOT_ENCRYPTED:${plaintext}`;
  return {
    ciphertext: toBase64(new TextEncoder().encode(marker)),
    type: "prekey",
  };
}

export function placeholderDecrypt(ciphertextBase64: string): string {
  try {
    const bytes = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const prefix = "GATEKEPT_PLACEHOLDER_NOT_ENCRYPTED:";
    return text.startsWith(prefix) ? text.slice(prefix.length) : "[unreadable]";
  } catch {
    return "[unreadable]";
  }
}
