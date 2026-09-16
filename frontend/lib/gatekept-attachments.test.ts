// Unit tests for lib/gatekept-attachments.ts — issue #26 / U6.
// Matches lib/auth.test.ts's existing pattern for this repo's frontend
// tests — plain .test.ts, no component rendering, no RTL (none is
// installed here; see vitest.config.ts's include list, which only covers
// lib/**/*.test.ts and app/**/*.test.ts).
//
// XMLHttpRequest is replaced with a small fake class giving full control
// over upload progress/load/error timing and captured request details —
// the same "swap the transport, keep the module's real code" approach
// lib/gatekept-ws.test.ts uses for WebSocket (see that file's own header
// comment for the parallel). No real network call is ever made.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  precheckAttachment,
  uploadAttachment,
  isPresignExpired,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "./gatekept-attachments";

function makeFile(name: string, type: string, sizeBytes: number): File {
  // Building an actual `sizeBytes`-length Blob would be wasteful for the
  // largest (oversized) test case — File/Blob report `.size` from the
  // parts array's total byte length, and a single-element array with one
  // pre-sized Uint8Array satisfies that without allocating a real
  // multi-megabyte string.
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

describe("precheckAttachment", () => {
  it("accepts every type in the documented allowlist", () => {
    for (const type of ALLOWED_ATTACHMENT_MIME_TYPES) {
      const file = makeFile("ok", type, 1024);
      expect(precheckAttachment(file)).toEqual({ allowed: true });
    }
  });

  it("rejects a disallowed MIME type immediately, with a reason", () => {
    const file = makeFile("virus.exe", "application/x-msdownload", 1024);
    const result = precheckAttachment(file);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("rejects an oversized file immediately, with a reason", () => {
    const file = makeFile("huge.mp4", "video/mp4", MAX_ATTACHMENT_SIZE_BYTES + 1);
    const result = precheckAttachment(file);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/large/i);
  });

  it("accepts a file exactly at the size limit", () => {
    const file = makeFile("max.mp4", "video/mp4", MAX_ATTACHMENT_SIZE_BYTES);
    expect(precheckAttachment(file).allowed).toBe(true);
  });

  it("rejects an empty file", () => {
    const file = makeFile("empty.png", "image/png", 0);
    expect(precheckAttachment(file).allowed).toBe(false);
  });
});

describe("isPresignExpired", () => {
  it("is false immediately after issuance", () => {
    expect(isPresignExpired(Date.now(), 900)).toBe(false);
  });

  it("is true once the expiry window has fully elapsed", () => {
    const issuedAtMs = Date.now() - 901 * 1000;
    expect(isPresignExpired(issuedAtMs, 900)).toBe(true);
  });

  it("is false just before the expiry window elapses", () => {
    const issuedAtMs = Date.now() - 800 * 1000;
    expect(isPresignExpired(issuedAtMs, 900)).toBe(false);
  });
});

describe("uploadAttachment", () => {
  const ORIGINAL_XHR = globalThis.XMLHttpRequest;

  class FakeXhr {
    static instances: FakeXhr[] = [];
    method = "";
    url = "";
    status = 0;
    upload = { onprogress: null as ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    headers: Record<string, string> = {};
    sentBody: unknown = null;

    constructor() {
      FakeXhr.instances.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      this.sentBody = body;
    }
  }

  beforeEach(() => {
    FakeXhr.instances = [];
    // @ts-expect-error -- test-only global override, matches
    // gatekept-ws.test.ts's ORIGINAL_WEBSOCKET swap pattern.
    globalThis.XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = ORIGINAL_XHR;
  });

  it("issues a PUT to the presigned URL with the file's Content-Type, and resolves on a 2xx response", async () => {
    const file = makeFile("photo.jpg", "image/jpeg", 100);
    const onProgress = vi.fn();

    const promise = uploadAttachment("https://s3.example.com/signed", file, onProgress);
    const xhr = FakeXhr.instances[0];

    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://s3.example.com/signed");
    expect(xhr.headers["Content-Type"]).toBe("image/jpeg");
    expect(xhr.sentBody).toBe(file);

    xhr.status = 200;
    xhr.onload?.();

    await expect(promise).resolves.toBeUndefined();
  });

  it("reports fractional progress via onprogress as upload.onprogress events fire", async () => {
    const file = makeFile("clip.mp4", "video/mp4", 1000);
    const onProgress = vi.fn();

    const promise = uploadAttachment("https://s3.example.com/signed", file, onProgress);
    const xhr = FakeXhr.instances[0];

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 250, total: 1000 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });
    expect(onProgress).toHaveBeenNthCalledWith(1, 0.25);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1);

    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it("rejects on a non-2xx response (simulated upload failure)", async () => {
    const file = makeFile("photo.jpg", "image/jpeg", 100);
    const promise = uploadAttachment("https://s3.example.com/signed", file, () => {});
    const xhr = FakeXhr.instances[0];

    xhr.status = 500;
    xhr.onload?.();

    await expect(promise).rejects.toThrow(/500/);
  });

  it("rejects on a network-level error event (simulated network drop mid-upload)", async () => {
    const file = makeFile("photo.jpg", "image/jpeg", 100);
    const promise = uploadAttachment("https://s3.example.com/signed", file, () => {});
    const xhr = FakeXhr.instances[0];

    xhr.onerror?.();

    await expect(promise).rejects.toThrow(/network/i);
  });
});
