import assert from "node:assert/strict";
import test from "node:test";

import { renderRealtimePanel } from "../src/realtime-view.ts";

const metrics = {
  totalCount: 2,
  completedCount: 2,
  successCount: 2,
  failureCount: 0,
  cancelledCount: 0,
  timeoutCount: 0,
  networkErrorCount: 0,
  protocolErrorCount: 0,
  successRate: 1,
  latency: {
    sampleCount: 2,
    minMs: 40,
    maxMs: 60,
    averageMs: 50,
    p50Ms: 50,
    p95Ms: 59,
    p99Ms: 60,
    standardDeviationMs: 10,
    jitterMs: 20
  }
};

test("renders the public WebSocket boundary in idle state", () => {
  const html = renderRealtimePanel({ phase: "idle" });
  assert.match(html, /公共 WebSocket 能力/);
  assert.match(html, /开始 20 秒长连接测试/);
});

test("renders live heartbeat progress", () => {
  const html = renderRealtimePanel({
    phase: "running",
    progress: {
      type: "heartbeat",
      url: "wss://example.com/",
      handshakeMs: 120,
      sentCount: 3,
      receivedCount: 2,
      lostCount: 1,
      latestSample: { status: "success", durationMs: 50 },
      metrics
    }
  });
  assert.match(html, /已发送 3 次/);
  assert.match(html, /120 ms/);
});

test("renders completed realtime metrics", () => {
  const html = renderRealtimePanel({
    phase: "result",
    result: {
      url: "wss://example.com/",
      status: "completed",
      handshakeMs: 120,
      connectionDurationMs: 20_000,
      targetDurationMs: 20_000,
      sentCount: 10,
      receivedCount: 10,
      lostCount: 0,
      samples: [],
      metrics,
      close: null
    }
  });
  assert.match(html, /连接保持完成/);
  assert.match(html, /59 ms/);
  assert.match(html, /AI 服务内部 WebSocket/);
});

test("escapes realtime errors", () => {
  const html = renderRealtimePanel({ phase: "error", message: "<script>" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
