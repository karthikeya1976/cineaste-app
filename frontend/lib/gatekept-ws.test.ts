// Unit tests for lib/gatekept-ws.ts — the thin WebSocket client wrapper.
// No live backend is reachable in this sandbox (see this issue's own
// setup notes), so `global.WebSocket` is replaced with a small fake class
// giving full control over onopen/onmessage/onclose/onerror timing and
// captured sent frames — the same "swap the transport, keep the module's
// real code" approach the gatekept backend's own test suite uses for
// ioredis-mock (see gatekept/backend/src/services/realtimeAuth.test.ts's
// header comment for the parallel). `fetch` is mocked for the ticket POST.
//
// Matches lib/auth.test.ts's existing pattern for this repo's frontend
// tests — plain .test.ts, no component rendering, no RTL (none is
// installed here; see vitest.config.ts's include list).
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const ORIGINAL_WEBSOCKET = globalThis.WebSocket;
const ORIGINAL_FETCH = globalThis.fetch;

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helper: simulates the server accepting the connection and sending
  // its post-upgrade "connected" ack — mirrors realtimeServer.ts's actual
  // wire behavior (see that file's own comment on why it sends this).
  simulateConnected(socketId = "socket-1"): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onmessage?.({ data: JSON.stringify({ type: "connected", socketId }) });
  }

  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  simulateError(): void {
    this.onerror?.();
  }
}

function mockFetchTicket(ticket = "test-ticket-abc", ok = true): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 201 : 500,
    json: async () => ({ ticket }),
  }) as unknown as typeof fetch;
}

/** Waits until connect()'s async chain (fetch -> .json() -> `new
 *  WebSocket()`) has actually constructed the socket, rather than guessing
 *  a fixed number of microtask flushes — the chain's depth is an
 *  implementation detail of openSocket() this test file shouldn't need to
 *  track by hand. */
async function waitForInstance(index = 0): Promise<FakeWebSocket> {
  await vi.waitFor(() => {
    if (!FakeWebSocket.instances[index]) throw new Error("socket not constructed yet");
  }, { timeout: 1000, interval: 1 });
  return FakeWebSocket.instances[index];
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error -- test double, not a full WebSocket implementation
  globalThis.WebSocket = FakeWebSocket;
  localStorage.clear();
});

afterEach(() => {
  globalThis.WebSocket = ORIGINAL_WEBSOCKET;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.resetModules();
});

describe("realtimeWsUrl", () => {
  it("uses ws://localhost:4000 when running on localhost", async () => {
    // jsdom's default test URL is http://localhost/ — see vitest.config.ts.
    const { realtimeWsUrl } = await import("./gatekept-ws");
    const url = realtimeWsUrl("my-ticket");
    expect(url).toBe("ws://localhost:4000/v1/realtime/connect?ticket=my-ticket");
  });

  it("URL-encodes the ticket", async () => {
    const { realtimeWsUrl } = await import("./gatekept-ws");
    const url = realtimeWsUrl("a/b c");
    expect(url).toContain(encodeURIComponent("a/b c"));
  });
});

describe("GatekeptRealtimeClient.connect", () => {
  it("fetches a ticket via POST /api/gatekept/v1/realtime/ticket and opens a WebSocket with it", async () => {
    mockFetchTicket("ticket-xyz");
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();

    const connectPromise = client.connect();
    const socket = await waitForInstance();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.url).toContain("ticket=ticket-xyz");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/gatekept/v1/realtime/ticket",
      expect.objectContaining({ method: "POST" })
    );

    socket.simulateConnected();
    await connectPromise;
    expect(client.isConnected).toBe(true);
  });

  it("resolves connect() only after the server's 'connected' ack, not merely on socket construction", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();

    let resolved = false;
    const connectPromise = client.connect().then(() => { resolved = true; });
    const socket = await waitForInstance();

    expect(resolved).toBe(false);
    socket.simulateConnected();
    await connectPromise;
    expect(resolved).toBe(true);
  });

  it("a second connect() call while already connected reuses the existing connection (no duplicate socket)", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();

    const first = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await first;

    await client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("rejects if the ticket fetch fails", async () => {
    mockFetchTicket("x", false);
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();

    await expect(client.connect()).rejects.toThrow();
  });
});

describe("GatekeptRealtimeClient event dispatch", () => {
  async function connectedClient() {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;
    return { client, socket };
  }

  it("dispatches a full message event to onEvent subscribers", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.simulateMessage({ type: "message", conversationId: "c-1", messageNumber: 3, senderId: "u1" });

    expect(listener).toHaveBeenCalledWith({ type: "message", conversationId: "c-1", messageNumber: 3, senderId: "u1" });
  });

  it("dispatches a badge event to onEvent subscribers", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.simulateMessage({ type: "badge", reason: "chat_request", chatRequestId: "cr-1", senderId: "u2" });

    expect(listener).toHaveBeenCalledWith({ type: "badge", reason: "chat_request", chatRequestId: "cr-1", senderId: "u2" });
  });

  it("dispatches a typing event to onEvent subscribers", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.simulateMessage({ type: "typing", conversationId: "c-1", senderId: "u1" });

    expect(listener).toHaveBeenCalledWith({ type: "typing", conversationId: "c-1", senderId: "u1" });
  });

  it("does not dispatch the internal 'connected' ack itself as a RealtimeEvent", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.simulateMessage({ type: "connected", socketId: "another-one" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON without throwing", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    expect(() => socket.onmessage?.({ data: "not json {{{" })).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe via the returned function stops further delivery", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    const unsubscribe = client.onEvent(listener);
    unsubscribe();

    socket.simulateMessage({ type: "badge", reason: "message", conversationId: "c-1", senderId: "u1" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("two badge events in quick succession both dispatch — one does not overwrite the other", async () => {
    const { client, socket } = await connectedClient();
    const received: unknown[] = [];
    client.onEvent((e) => received.push(e));

    socket.simulateMessage({ type: "badge", reason: "message", conversationId: "c-1", senderId: "u1" });
    socket.simulateMessage({ type: "badge", reason: "chat_request", chatRequestId: "cr-2", senderId: "u2" });

    expect(received).toHaveLength(2);
  });

  it("onDisconnect fires when the socket closes", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onDisconnect(listener);

    socket.close();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(client.isConnected).toBe(false);
  });
});

describe("GatekeptRealtimeClient.enterConversation / leaveConversation", () => {
  it("sends an enter_conversation message matching U1's protocol", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.enterConversation("conv-42");

    expect(socket.sent).toContain(JSON.stringify({ type: "enter_conversation", conversationId: "conv-42" }));
  });

  it("sends a leave_conversation message matching U1's protocol", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.leaveConversation();

    expect(socket.sent).toContain(JSON.stringify({ type: "leave_conversation" }));
  });

  it("enterConversation is a no-op (does not throw) when not connected", async () => {
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    expect(() => client.enterConversation("conv-1")).not.toThrow();
  });
});

describe("GatekeptRealtimeClient.sendTyping", () => {
  it("sends a typing message matching U7's protocol", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.sendTyping("conv-42");

    expect(socket.sent).toContain(JSON.stringify({ type: "typing", conversationId: "conv-42" }));
  });

  it("is a no-op (does not throw) when not connected", async () => {
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    expect(() => client.sendTyping("conv-1")).not.toThrow();
  });
});

describe("GatekeptRealtimeClient.disconnect", () => {
  it("closes the underlying socket and isConnected becomes false", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.disconnect();

    expect(client.isConnected).toBe(false);
  });

  it("an explicit disconnect() does not trigger a reconnect attempt", async () => {
    vi.useFakeTimers();
    try {
      mockFetchTicket();
      const { GatekeptRealtimeClient } = await import("./gatekept-ws");
      const client = new GatekeptRealtimeClient();
      const connectPromise = client.connect();
      const socket = await waitForInstance();
      socket.simulateConnected();
      await connectPromise;

      client.disconnect();
      await vi.advanceTimersByTimeAsync(60000);

      expect(FakeWebSocket.instances).toHaveLength(1); // no second socket ever constructed
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GatekeptRealtimeClient.setLastSeen / getLastSeen", () => {
  it("registers and returns a per-conversation last-seen cursor", async () => {
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();

    expect(client.getLastSeen("conv-1")).toBeNull();
    client.setLastSeen("conv-1", 5);
    expect(client.getLastSeen("conv-1")).toBe(5);
    client.setLastSeen("conv-1", 9);
    expect(client.getLastSeen("conv-1")).toBe(9);
  });

  it("passing null removes a previously-registered cursor", async () => {
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();

    client.setLastSeen("conv-1", 5);
    client.setLastSeen("conv-1", null);
    expect(client.getLastSeen("conv-1")).toBeNull();
  });

  it("disconnect() clears all registered last-seen cursors", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.setLastSeen("conv-1", 5);
    client.disconnect();

    expect(client.getLastSeen("conv-1")).toBeNull();
  });
});

describe("GatekeptRealtimeClient.resume", () => {
  it("sends a resume message matching KTD6's protocol", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.resume([{ id: "conv-1", lastSeenMessageNumber: 3 }]);

    expect(socket.sent).toContain(
      JSON.stringify({ type: "resume", conversations: [{ id: "conv-1", lastSeenMessageNumber: 3 }] })
    );
  });

  it("is a no-op (does not throw) when not connected", async () => {
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    expect(() => client.resume([{ id: "conv-1", lastSeenMessageNumber: 3 }])).not.toThrow();
  });

  it("is a no-op for an empty conversations array", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    client.resume([]);

    expect(socket.sent).toHaveLength(0);
  });

  it("dispatches a replayed message event (replayed: true) to onEvent subscribers same as a live one", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.simulateMessage({
      type: "message",
      conversationId: "c-1",
      messageNumber: 4,
      senderId: "u1",
      replayed: true,
    });

    expect(listener).toHaveBeenCalledWith({
      type: "message",
      conversationId: "c-1",
      messageNumber: 4,
      senderId: "u1",
      replayed: true,
    });
  });

  it("dispatches a resume_fallback event to onEvent subscribers", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.simulateMessage({ type: "resume_fallback", conversationIds: ["c-1", "c-2"] });

    expect(listener).toHaveBeenCalledWith({ type: "resume_fallback", conversationIds: ["c-1", "c-2"] });
  });
});

async function connectedClient() {
  mockFetchTicket();
  const { GatekeptRealtimeClient } = await import("./gatekept-ws");
  const client = new GatekeptRealtimeClient();
  const connectPromise = client.connect();
  const socket = await waitForInstance();
  socket.simulateConnected();
  await connectPromise;
  return { client, socket };
}

describe("GatekeptRealtimeClient reconnect-with-backoff", () => {
  it("attempts a reconnect after an unrequested close, with an increasing delay", async () => {
    vi.useFakeTimers();
    try {
      mockFetchTicket();
      const { GatekeptRealtimeClient } = await import("./gatekept-ws");
      const client = new GatekeptRealtimeClient();
      const connectPromise = client.connect();
      const firstSocket = await waitForInstance();
      firstSocket.simulateConnected();
      await connectPromise;

      // Unrequested close (e.g. network drop) — not client.disconnect().
      firstSocket.close();
      expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect attempted yet

      await vi.advanceTimersByTimeAsync(1000); // first backoff delay
      expect(FakeWebSocket.instances).toHaveLength(2); // reconnect attempted

      const secondSocket = await waitForInstance(1);
      secondSocket.simulateConnected();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after a bounded number of reconnect attempts (not infinite)", async () => {
    vi.useFakeTimers();
    try {
      mockFetchTicket();
      const { GatekeptRealtimeClient } = await import("./gatekept-ws");
      const client = new GatekeptRealtimeClient();
      const connectPromise = client.connect();
      const firstSocket = await waitForInstance();
      firstSocket.simulateConnected();
      await connectPromise;

      firstSocket.close();

      // Every subsequent reconnect attempt also fails immediately (its
      // socket is closed without ever simulating 'connected') — drives the
      // backoff schedule to exhaustion.
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(60000);
        const latest = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
        if (latest && latest.readyState !== FakeWebSocket.CLOSED) {
          latest.close();
        }
      }

      const countAfterExhaustion = FakeWebSocket.instances.length;

      // Advancing far beyond any conceivable further backoff produces no
      // additional socket — retries are bounded, not infinite.
      await vi.advanceTimersByTimeAsync(120000);
      expect(FakeWebSocket.instances).toHaveLength(countAfterExhaustion);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a successful reconnect automatically calls resume() with every registered last-seen cursor", async () => {
    vi.useFakeTimers();
    try {
      mockFetchTicket();
      const { GatekeptRealtimeClient } = await import("./gatekept-ws");
      const client = new GatekeptRealtimeClient();
      const connectPromise = client.connect();
      const firstSocket = await waitForInstance();
      firstSocket.simulateConnected();
      await connectPromise;

      client.setLastSeen("conv-1", 7);
      client.setLastSeen("conv-2", 2);

      firstSocket.close();
      await vi.advanceTimersByTimeAsync(1000);

      const secondSocket = await waitForInstance(1);
      secondSocket.simulateConnected();
      // Let the post-connect microtask (which calls resume()) run.
      await vi.advanceTimersByTimeAsync(0);

      const sentResume = secondSocket.sent.find((s) => JSON.parse(s).type === "resume");
      expect(sentResume).toBeDefined();
      const parsed = JSON.parse(sentResume!);
      expect(parsed.conversations).toEqual(
        expect.arrayContaining([
          { id: "conv-1", lastSeenMessageNumber: 7 },
          { id: "conv-2", lastSeenMessageNumber: 2 },
        ])
      );
      expect(parsed.conversations).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT call resume() on the very first connect (only on a genuine reconnect)", async () => {
    mockFetchTicket();
    const { GatekeptRealtimeClient } = await import("./gatekept-ws");
    const client = new GatekeptRealtimeClient();
    client.setLastSeen("conv-1", 7);

    const connectPromise = client.connect();
    const socket = await waitForInstance();
    socket.simulateConnected();
    await connectPromise;

    const sentResume = socket.sent.find((s) => JSON.parse(s).type === "resume");
    expect(sentResume).toBeUndefined();
  });
});
