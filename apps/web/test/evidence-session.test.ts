import assert from "node:assert/strict";
import test from "node:test";

import { createBenchmarkReport } from "@ai-network-check/core";
import type { WebSocketBenchmarkResult } from "@ai-network-check/websocket-benchmark";
import { createEvidenceSession } from "../src/evidence-session.ts";

const times = [
  "2026-07-20T12:00:00.000Z",
  "2026-07-20T12:00:01.000Z",
  "2026-07-20T12:00:02.000Z",
  "2026-07-20T12:00:03.000Z",
  "2026-07-20T12:00:04.000Z"
];

function session() {
  let index = 0;
  return createEvidenceSession({
    expectedServiceIds: ["openai", "anthropic"],
    now: () => times[Math.min(index++, times.length - 1)]!
  });
}

function webReport() {
  return createBenchmarkReport({
    mode: "web",
    confidence: "browser-basic",
    route: "LA-01",
    startedAt: "2026-07-20T11:59:00.000Z",
    completedAt: "2026-07-20T12:00:00.000Z",
    services: [],
    limitations: [
      "http-status-unverified",
      "network-phases-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ]
  });
}

const socketResult: WebSocketBenchmarkResult = {
  url: "wss://ws.postman-echo.com/raw",
  status: "completed",
  handshakeMs: 100,
  connectionDurationMs: 20_000,
  targetDurationMs: 20_000,
  sentCount: 1,
  receivedCount: 1,
  lostCount: 0,
  samples: [{ status: "success", durationMs: 40 }],
  metrics: {
    totalCount: 1,
    completedCount: 1,
    successCount: 1,
    failureCount: 0,
    cancelledCount: 0,
    timeoutCount: 0,
    networkErrorCount: 0,
    protocolErrorCount: 0,
    successRate: 1,
    latency: {
      sampleCount: 1,
      minMs: 40,
      maxMs: 40,
      averageMs: 40,
      p50Ms: 40,
      p95Ms: 40,
      p99Ms: 40,
      standardDeviationMs: 0,
      jitterMs: 0
    }
  },
  close: null
};

test("starts with explicit missing-evidence limitations", () => {
  const snapshot = session().snapshot();
  assert.equal(snapshot.hasEvidence, false);
  assert.ok(snapshot.report.limitations.includes("real-tool-not-run"));
  assert.ok(
    snapshot.report.limitations.includes("local-network-phases-partial")
  );
});

test("attaches the latest web route and public WebSocket evidence", () => {
  const value = session();
  value.attachWebReport(webReport());
  value.attachPublicWebSocket(socketResult);
  const snapshot = value.snapshot();
  assert.equal(snapshot.report.route, "LA-01");
  assert.equal(snapshot.coverage.webHttps, true);
  assert.equal(snapshot.coverage.publicWebSocket, true);
  assert.equal(snapshot.report.publicWebSocket?.verifiedScope, "public-echo-only");
});

test("upserts local services and real Codex evidence", () => {
  const value = session();
  value.attachLocalNetwork({
    source: "service-catalog",
    serviceId: "openai",
    displayName: "OpenAI",
    cancelled: false,
    endpoints: []
  });
  value.attachLocalNetwork({
    source: "service-catalog",
    serviceId: "openai",
    displayName: "OpenAI Updated",
    cancelled: false,
    endpoints: []
  });
  value.attachCodex({
    promptId: "reply-exactly-ok-v1",
    result: {
      status: "success",
      inspection: {
        installed: true,
        authenticated: true,
        version: "codex 1"
      },
      durationMs: 1000,
      firstEventMs: 100,
      firstAgentMessageMs: 500,
      exitCode: 0,
      responseMatched: true,
      sawTurnCompleted: true,
      eventCounts: {}
    }
  });

  const snapshot = value.snapshot();
  assert.equal(snapshot.report.localNetwork.length, 1);
  assert.equal(snapshot.report.localNetwork[0]?.displayName, "OpenAI Updated");
  assert.equal(snapshot.coverage.realCodex, true);
  assert.equal(snapshot.report.limitations.includes("real-tool-not-run"), false);
});

test("keeps cancelled local evidence without counting it as completed coverage", () => {
  const value = session();
  value.attachLocalNetwork({
    source: "service-catalog",
    serviceId: "openai",
    displayName: "OpenAI",
    cancelled: true,
    endpoints: []
  });

  const snapshot = value.snapshot();
  assert.equal(snapshot.report.localNetwork.length, 1);
  assert.equal(snapshot.coverage.localNetworkServiceCount, 0);
  assert.equal(snapshot.hasEvidence, true);
  assert.ok(
    snapshot.report.limitations.includes("local-network-phases-partial")
  );
});

test("notifies subscribers and resets without persisting evidence", () => {
  const value = session();
  let notifications = 0;
  const unsubscribe = value.subscribe(() => notifications++);
  value.attachWebReport(webReport());
  value.reset();
  unsubscribe();

  assert.equal(notifications, 3);
  assert.equal(value.snapshot().hasEvidence, false);
});
