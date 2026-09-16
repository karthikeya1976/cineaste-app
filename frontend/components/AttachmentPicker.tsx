"use client";

// Compose-form attachment picker — issue #26 / U6.
//
// Renders the four explicit client-side states named in the issue, never
// a single binary "sending" flag:
//   1. selected-unsent — filename + thumbnail/icon + remove button, zero
//      network calls (verified in AttachmentPicker.test.tsx: removing
//      before send never calls presign).
//   2. uploading — a slim progress bar tracked via the presigned PUT's
//      real upload-progress events (see lib/gatekept-attachments.ts's
//      uploadAttachment, XMLHttpRequest-based since fetch has no upload
//      progress API).
//   3. upload-failed — this codebase's existing error-banner pattern
//      (#7f1d1d22 background / #f87171 text, already used throughout
//      messages/*.tsx) with a Retry action.
//   4. rejected-before-upload — same error-banner pattern, shown
//      immediately on selection via precheckAttachment(), before any
//      network call.
//
// This component owns none of the actual upload/presign network calls —
// it's a controlled, presentational + file-selection component. The
// conversation page owns state transitions and calls uploadAttachment()/
// presignAttachment() itself, passing this component only the current
// state and callbacks. Keeping the network calls out of this component is
// what makes "removal before send never calls presign" simple to verify:
// there is no code path inside this file that could call presign at all.
import { useRef } from "react";
import { precheckAttachment } from "@/lib/gatekept-attachments";

export type AttachmentState =
  | { kind: "idle" }
  | { kind: "selected"; file: File; previewUrl: string | null }
  | { kind: "uploading"; file: File; previewUrl: string | null; progress: number }
  | { kind: "failed"; file: File; previewUrl: string | null; message: string }
  | { kind: "rejected"; filename: string; message: string };

export interface PendingAttachment {
  file: File;
  previewUrl: string | null;
}

const errorBannerStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#f87171",
  background: "#7f1d1d22",
  border: "1px solid #7f1d1d55",
  borderRadius: "8px",
  padding: "8px 10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "13px",
  color: "var(--fg)",
};

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function FileIcon() {
  return (
    <div
      style={{
        width: "32px",
        height: "32px",
        borderRadius: "6px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "14px",
        flexShrink: 0,
      }}
      aria-hidden
    >
      📄
    </div>
  );
}

export interface AttachmentPickerProps {
  state: AttachmentState;
  onSelect: (attachment: PendingAttachment) => void;
  onReject: (filename: string, message: string) => void;
  onRemove: () => void;
  onRetry: () => void;
  disabled?: boolean;
}

export function AttachmentPicker({
  state,
  onSelect,
  onReject,
  onRemove,
  onRetry,
  disabled,
}: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so selecting the SAME file again after a
    // remove/reject still fires a change event (browsers otherwise
    // suppress a change event for an unchanged value).
    e.target.value = "";
    if (!file) return;

    const check = precheckAttachment(file);
    if (!check.allowed) {
      // State (4): rejected-before-upload — shown immediately, no network
      // call made at all.
      onReject(file.name, check.reason ?? "This file can't be attached.");
      return;
    }

    const previewUrl = isImageFile(file) ? URL.createObjectURL(file) : null;
    // State (1): selected-unsent — zero network calls here.
    onSelect({ file, previewUrl });
  }

  if (state.kind === "idle") {
    return (
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "40px",
          height: "40px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--fg-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          fontSize: "18px",
          flexShrink: 0,
        }}
        title="Attach a file"
      >
        📎
        <input
          ref={inputRef}
          type="file"
          accept={Array.from(
            new Set([
              "image/*",
              "video/mp4",
              "video/webm",
              "audio/mpeg",
              "audio/wav",
              "application/pdf",
            ])
          ).join(",")}
          onChange={handleFileChosen}
          disabled={disabled}
          style={{ display: "none" }}
        />
      </label>
    );
  }

  if (state.kind === "rejected") {
    return (
      <div style={errorBannerStyle} role="alert">
        <span>
          <strong>{state.filename}</strong> — {state.message}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "12px" }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (state.kind === "selected") {
    return (
      <div style={rowStyle}>
        {state.previewUrl ? (
          // Local blob: object URL for an unsent local file selection, not
          // a remote/optimizable image — a plain <img> is used rather than
          // next/image.
          <img
            src={state.previewUrl}
            alt=""
            style={{ width: "32px", height: "32px", borderRadius: "6px", objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <FileIcon />
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.file.name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: "none", border: "none", color: "var(--fg-muted)", cursor: "pointer", fontSize: "16px", lineHeight: 1 }}
          aria-label="Remove attachment"
          title="Remove"
        >
          ✕
        </button>
      </div>
    );
  }

  if (state.kind === "uploading") {
    const pct = Math.round(state.progress * 100);
    return (
      <div style={rowStyle}>
        {state.previewUrl ? (
          <img
            src={state.previewUrl}
            alt=""
            style={{ width: "32px", height: "32px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, opacity: 0.6 }}
          />
        ) : (
          <FileIcon />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "4px" }}>
            {state.file.name} — Uploading… {pct}%
          </div>
          <div style={{ height: "4px", borderRadius: "2px", background: "var(--border)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "var(--accent)",
                transition: "width 120ms linear",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // state.kind === "failed"
  return (
    <div style={errorBannerStyle} role="alert">
      <span>
        <strong>{state.file.name}</strong> — Upload failed: {state.message}
      </span>
      <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onRetry}
          style={{ background: "none", border: "1px solid #f8717155", color: "#f87171", borderRadius: "6px", padding: "2px 8px", cursor: "pointer", fontSize: "12px" }}
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "12px" }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
