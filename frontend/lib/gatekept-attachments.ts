// Client-side attachment helpers — issue #26 / U6.
//
// Two things live here: (1) a client-side MIME/size pre-check mirroring
// the backend's own allowlist (attachmentService.ts's ALLOWED_MIME_TYPES/
// maxSizeBytes), so a disallowed/oversized file is rejected immediately on
// selection — before any network call at all — rather than only after a
// round trip to /v1/attachments/presign; and (2) uploadAttachment(), the
// actual presigned-PUT upload with real progress events.
//
// WHY XMLHttpRequest, NOT fetch: fetch's Response/Request streaming APIs
// expose download progress but not upload progress — there is no event or
// callback anywhere in the fetch API that fires as request body bytes are
// sent. XMLHttpRequest's `upload.onprogress` is the only web-platform API
// that provides this, which is exactly what the issue's "uploading" state
// needs (a progress bar tracking real bytes-sent, not a fake spinner).

export const ALLOWED_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // Audio/video
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  // Documents
  "application/pdf",
]);

// Mirrors the backend's default ATTACHMENT_MAX_SIZE_BYTES (25 MB) — see
// gatekept/backend/src/config.ts's attachments.maxSizeBytes. Kept as a
// plain client-side constant rather than fetched from the server: this is
// a pre-check only, a UX nicety that saves a round trip for the common
// case, never the actual enforcement boundary (the server re-validates
// unconditionally in attachmentService.presignUpload — see that module's
// own comment on why a client-declared value is never trusted for
// anything security-relevant).
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

export interface AttachmentPreCheckResult {
  allowed: boolean;
  reason?: string;
}

/** Client-side pre-check mirroring the server allowlist, per the issue's
 *  "rejected before upload" state (4): shown immediately on file
 *  selection, before any network call. This is advisory only — the server
 *  performs the authoritative check on the presign call regardless of what
 *  this returns, so a mismatch here (e.g. this list going stale) fails
 *  safe: the worst case is a file that should have been rejected client-
 *  side instead getting rejected one round trip later by the real
 *  presign call, never the other way around. */
export function precheckAttachment(file: File): AttachmentPreCheckResult {
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type)) {
    return {
      allowed: false,
      reason: file.type
        ? `"${file.type}" files aren't supported.`
        : "This file type isn't supported.",
    };
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    const maxMb = Math.floor(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024));
    return { allowed: false, reason: `File is too large (max ${maxMb} MB).` };
  }
  if (file.size <= 0) {
    return { allowed: false, reason: "File appears to be empty." };
  }
  return { allowed: true };
}

/**
 * Uploads `file` directly to `uploadUrl` (a presigned S3 PUT URL) via
 * XMLHttpRequest, reporting fractional progress (0..1) as bytes are sent.
 * Rejects on any non-2xx response or network-level error/abort — callers
 * (the conversation page's upload-failed state) are expected to catch this
 * and offer Retry, per the issue's explicit acceptance criterion.
 */
export function uploadAttachment(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (S3 responded ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.onabort = () => reject(new Error("Upload was cancelled"));

    xhr.send(file);
  });
}

/** True if the presigned URL's expiry (returned alongside it) has already
 *  elapsed, given when it was issued — used by the conversation page's
 *  Retry action to decide "reuse the same presigned URL" vs. "re-presign",
 *  per the issue's explicit Retry behavior. */
export function isPresignExpired(issuedAtMs: number, expiresInSeconds: number): boolean {
  return Date.now() >= issuedAtMs + expiresInSeconds * 1000;
}
