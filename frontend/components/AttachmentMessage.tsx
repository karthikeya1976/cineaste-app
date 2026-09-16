"use client";

// Renders an attachment_ref inside a message bubble in the thread —
// issue #26 / U6. Image types get an inline preview fetched via a
// presigned GET URL (requested on render, not baked into the message
// payload — the backend never returns a public URL, only ever a
// short-lived presigned one per KTD8); anything else renders as a
// generic file link/icon that opens the presigned URL in a new tab on
// click (fetched lazily, on click, not on render, since a document/video
// doesn't need to preload).
import { useEffect, useState } from "react";
import { presignAttachmentDownload } from "@/lib/gatekept-api";

// Mirrors the backend's own allowlist image subset (attachmentService.ts's
// ALLOWED_MIME_TYPES) — but attachment_ref carries no MIME type, only a
// key, so this infers "probably an image" from the key's own extension-
// like suffix... except server-generated keys are bare UUIDs with NO
// extension (see attachmentService.ts's generateAttachmentKey — this is
// deliberate, the key is never derived from the filename). Since the key
// alone can't tell us the type, this component always attempts an image
// preview first and falls back to the generic file link if the image
// fails to load — see the <img onError> handler below.
function extractDisplayName(attachmentRef: string): string {
  const last = attachmentRef.split("/").pop() ?? attachmentRef;
  return last;
}

export interface AttachmentMessageProps {
  conversationId: string;
  attachmentRef: string;
}

export function AttachmentMessage({ conversationId, attachmentRef }: AttachmentMessageProps) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    presignAttachmentDownload(conversationId, attachmentRef)
      .then(({ downloadUrl }) => {
        if (!cancelled) setDownloadUrl(downloadUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, attachmentRef]);

  if (error) {
    return (
      <div style={{ fontSize: "12px", color: "var(--fg-muted)", fontStyle: "italic" }}>
        Attachment unavailable
      </div>
    );
  }

  if (!downloadUrl) {
    return (
      <div style={{ fontSize: "12px", color: "var(--fg-muted)" }}>Loading attachment…</div>
    );
  }

  if (!imageFailed) {
    return (
      // A short-lived, per-viewer presigned S3 URL isn't a stable asset
      // Next's image optimizer can usefully cache/transform, so a plain
      // <img> is used here rather than next/image.
      <img
        src={downloadUrl}
        alt={extractDisplayName(attachmentRef)}
        onError={() => setImageFailed(true)}
        style={{ maxWidth: "220px", maxHeight: "220px", borderRadius: "8px", display: "block" }}
      />
    );
  }

  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13px",
        color: "inherit",
        textDecoration: "underline",
      }}
    >
      <span aria-hidden>📄</span>
      <span>{extractDisplayName(attachmentRef)}</span>
    </a>
  );
}
