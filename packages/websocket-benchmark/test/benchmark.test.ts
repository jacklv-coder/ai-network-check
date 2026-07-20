import assert from "node:assert/strict";
import test from "node:test";

import {
  runWebSocketBenchmark,
  WebSocketBenchmarkCancelledError,
  type WebSocketLike
} from "../src/index.ts";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  readonly sent: string[] = [];
  onSend: ((payload: string) => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(data);
    this.onSend?.(data);
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  close(code = 1000, reason = "", wasClean = code === 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean });
  }
}

function successfulDependencies(socket: FakeSocket) {
  return {
    createWebSocket: () => {
      queueMicrotask(() => socket.open());
      return socket;
    },
    createSessionId: () => "session-test"
  };
}

test("rejects non-secure websocket URLs", async () => {
  await assert.rejects(
    () => runWebSocketBenchmark({ url: "ws://example.com" }),
    /secure wss protocol/
  );
});

test("measures handshake and echoed heartbeat RTT", async () => {
  const socket = new FakeSocket();
  socket.onSend = (payload) => queueMicrotask(() => socket.message(payload));

  const result = await runWebSocketBenchmark(
    {
      url: "wss://example.com/echo",
      durationMs: 16,
      heartbeatIntervalMs: 3,
      heartbeatTimeoutMs: 20,
      handshakeTimeoutMs: 20
    },
    successfulDependencies(socket)
  );

  assert.equal(result.status, "completed");
  assert.ok(result.handshakeMs !== null);
  assert.ok(result.sentCount >= 2);
  assert.equal(result.receivedCount, result.sentCount);
  assert.equal(result.lostCount, 0);
  assert.equal(result.metrics.successRate, 1);
});

test("reports a handshake timeout when the socket never opens", async () => {
  const socket = new FakeSocket();
  const result = await runWebSocketBenchmark(
    { url: "wss://example.com", handshakeTimeoutMs: 3, durationMs: 5 },
    { createWebSocket: () => socket, createSessionId: () => "timeout" }
  );

  assert.equal(result.status, "handshake-timeout");
  assert.equal(result.handshakeMs, null);
  assert.equal(result.sentCount, 0);
});

test("counts a heartbeat timeout as a lost message", async () => {
  const socket = new FakeSocket();
  const result = await runWebSocketBenchmark(
    {
      url: "wss://example.com",
      durationMs: 8,
      heartbeatIntervalMs: 1,
      heartbeatTimeoutMs: 2,
      handshakeTimeoutMs: 20
    },
    successfulDependencies(socket)
  );

  assert.equal(result.status, "completed");
  assert.ok(result.lostCount > 0);
  assert.equal(result.receivedCount, 0);
  assert.equal(result.metrics.timeoutCount, result.lostCount);
});

test("classifies a socket close during a heartbeat", async () => {
  const socket = new FakeSocket();
  socket.onSend = () => queueMicrotask(() => socket.close(1006, "dropped", false));

  const result = await runWebSocketBenchmark(
    {
      url: "wss://example.com",
      durationMs: 20,
      heartbeatIntervalMs: 2,
      heartbeatTimeoutMs: 20,
      handshakeTimeoutMs: 20
    },
    successfulDependencies(socket)
  );

  assert.equal(result.status, "closed-early");
  assert.equal(result.close?.code, 1006);
  assert.equal(result.metrics.networkErrorCount, 1);
});

test("ignores unrelated messages before matching the echo", async () => {
  const socket = new FakeSocket();
  socket.onSend = (payload) => {
    queueMicrotask(() => {
      socket.message("unrelated");
      socket.message(payload);
    });
  };

  const result = await runWebSocketBenchmark(
    {
      url: "wss://example.com",
      durationMs: 7,
      heartbeatIntervalMs: 2,
      heartbeatTimeoutMs: 20,
      handshakeTimeoutMs: 20
    },
    successfulDependencies(socket)
  );

  assert.equal(result.status, "completed");
  assert.equal(result.receivedCount, result.sentCount);
});

test("throws a dedicated cancellation error for a pre-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => runWebSocketBenchmark({ url: "wss://example.com", signal: controller.signal }),
    WebSocketBenchmarkCancelledError
  );
});

test("emits all progress phases", async () => {
  const socket = new FakeSocket();
  const events: string[] = [];
  socket.onSend = (payload) => queueMicrotask(() => socket.message(payload));

  await runWebSocketBenchmark(
    {
      url: "wss://example.com",
      durationMs: 6,
      heartbeatIntervalMs: 2,
      heartbeatTimeoutMs: 20,
      handshakeTimeoutMs: 20,
      onProgress: (event) => events.push(event.type)
    },
    successfulDependencies(socket)
  );

  assert.equal(events[0], "connecting");
  assert.ok(events.includes("connected"));
  assert.ok(events.includes("heartbeat"));
  assert.equal(events.at(-1), "completed");
});
