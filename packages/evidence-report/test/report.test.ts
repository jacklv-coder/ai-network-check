import assert from "node:assert/strict";
import test from "node:test";

import { createBenchmarkReport } from "../../core/src/index.ts";
import {
  createEvidenceReport,
  parseEvidenceReport,
  serializeEvidenceReport,
  upsertLocalNetworkEvidence,
  upsertRealToolEvidence,
  validateEvidenceReport,
  withPublicWebSocketEvidence,
  withWebReport,
  type LocalNetworkServiceEvidence,
  type PublicWebSocketEvidence,
  type RealToolEvidence
} from "../src/index.ts";

const collectedAt = "2026-07-20T12:00:00.000Z";

const publicWebSocket: PublicWebSocketEvidence = {
  kind: "public-websocket",
  provider: "postman-echo",
  verifiedScope: "public-echo-only",
  collectedAt,
  result: {
    url: "wss://ws.postman-echo.com/raw",
    status: "completed",
    handshakeMs: 120,
    connectionDurationMs: 20_000,
    targetDurationMs: 20_000,
    sentCount: 10,
    receivedCount: 10,
    lostCount: 0,
    samples: [{ status: "success", durationMs: 45 }],
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
        minMs: 45,
        maxMs: 45,
        averageMs: 45,
        p50Ms: 45,
        p95Ms: 45,
        p99Ms: 45,
        standardDeviationMs: 0,
        jitterMs: 0
      }
    },
    close: null
  }
};

const localNetwork: LocalNetworkServiceEvidence = {
  kind: "local-network-phases",
  source: "service-catalog",
  serviceId: "openai",
  displayName: "OpenAI",
  collectedAt,
  cancelled: false,
  endpoints: [
    {
      endpointId: "openai-api",
      label: "OpenAI API",
      role: "api",
      critical: true,
      result: {
        url: "https://api.openai.com/",
        hostname: "api.openai.com",
        status: "success",
        resolvedAddress: "203.0.113.10",
        addressFamily: 4,
        httpStatus: 401,
        phases: {
          dnsMs: 10,
          tcpMs: 20,
          tlsMs: 30,
          requestToFirstByteMs: 40,
          totalToFirstByteMs: 100
        },
        errorCode: null
      }
    }
  ]
};

const realTool: RealToolEvidence = {
  kind: "real-tool",
  tool: "codex",
  promptId: "reply-exactly-ok-v1",
  collectedAt,
  result: {
    status: "success",
    inspection: {
      installed: true,
      authenticated: true,
      version: "codex 1.0"
    },
    durationMs: 1500,
    firstEventMs: 250,
    firstAgentMessageMs: 900,
    exitCode: 0,
    responseMatched: true,
    sawTurnCompleted: true,
    eventCounts: { "thread.started": 1, "turn.completed": 1 }
  }
};

function emptyWebReport() {
  return createBenchmarkReport({
    mode: "web",
    confidence: "browser-basic",
    route: "LA-01",
    startedAt: "2026-07-20T11:59:00.000Z",
    completedAt: collectedAt,
    services: [],
    limitations: [
      "http-status-unverified",
      "network-phases-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ]
  });
}

test("creates a normalized empty evidence report", () => {
  const report = createEvidenceReport({
    createdAt: collectedAt,
    route: "  LA-01  ",
    limitations: ["real-tool-not-run", "real-tool-not-run"]
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "ai-network-check-evidence");
  assert.equal(report.route, "LA-01");
  assert.deepEqual(report.limitations, ["real-tool-not-run"]);
  assert.deepEqual(validateEvidenceReport(report), []);
});

test("combines all evidence classes without changing their verification scope", () => {
  let report = createEvidenceReport({ createdAt: collectedAt });
  report = withWebReport(report, emptyWebReport());
  report = withPublicWebSocketEvidence(report, publicWebSocket);
  report = upsertLocalNetworkEvidence(report, localNetwork);
  report = upsertRealToolEvidence(report, realTool);

  assert.equal(report.webReport?.confidence, "browser-basic");
  assert.equal(report.publicWebSocket?.verifiedScope, "public-echo-only");
  assert.equal(report.localNetwork[0]?.source, "service-catalog");
  assert.equal(report.realTools[0]?.tool, "codex");
});

test("upserts local services and real tools by stable identifiers", () => {
  let report = createEvidenceReport({
    createdAt: collectedAt,
    localNetwork: [localNetwork],
    realTools: [realTool]
  });
  report = upsertLocalNetworkEvidence(report, {
    ...localNetwork,
    displayName: "OpenAI Updated"
  });
  report = upsertRealToolEvidence(report, {
    ...realTool,
    result: { ...realTool.result, durationMs: 999 }
  });

  assert.equal(report.localNetwork.length, 1);
  assert.equal(report.localNetwork[0]?.displayName, "OpenAI Updated");
  assert.equal(report.realTools.length, 1);
  assert.equal(report.realTools[0]?.result.durationMs, 999);
});

test("round trips through versioned JSON", () => {
  const source = createEvidenceReport({
    createdAt: collectedAt,
    route: "SG-01",
    webReport: emptyWebReport(),
    publicWebSocket,
    localNetwork: [localNetwork],
    realTools: [realTool],
    limitations: ["public-websocket-only"]
  });
  const parsed = parseEvidenceReport(serializeEvidenceReport(source));
  assert.deepEqual(parsed, source);
});

test("rejects duplicate local services", () => {
  assert.throws(
    () =>
      createEvidenceReport({
        createdAt: collectedAt,
        localNetwork: [localNetwork, localNetwork]
      }),
    /duplicate local network service/
  );
});

test("rejects negative phase timings", () => {
  const invalid = {
    ...localNetwork,
    endpoints: [
      {
        ...localNetwork.endpoints[0]!,
        result: {
          ...localNetwork.endpoints[0]!.result,
          phases: {
            ...localNetwork.endpoints[0]!.result.phases!,
            tlsMs: -1
          }
        }
      }
    ]
  };
  assert.throws(
    () =>
      createEvidenceReport({
        createdAt: collectedAt,
        localNetwork: [invalid]
      }),
    /tlsMs must be non-negative/
  );
});

test("rejects sensitive fields even when injected at runtime", () => {
  const injected = {
    ...realTool,
    result: {
      ...realTool.result,
      stdout: "secret model output",
      token: "secret"
    }
  } as unknown as RealToolEvidence;

  assert.throws(
    () =>
      createEvidenceReport({
        createdAt: collectedAt,
        realTools: [injected]
      }),
    /stdout is not allowed|token is not allowed/
  );
});

test("rejects invalid public WebSocket scope", () => {
  const invalid = {
    ...publicWebSocket,
    verifiedScope: "ai-internal"
  } as unknown as PublicWebSocketEvidence;
  assert.throws(
    () =>
      createEvidenceReport({
        createdAt: collectedAt,
        publicWebSocket: invalid
      }),
    /public-echo-only/
  );
});

test("rejects malformed JSON and unsupported schema versions", () => {
  assert.throws(() => parseEvidenceReport("{"), /not valid JSON/);
  const report = createEvidenceReport({ createdAt: collectedAt });
  const unsupported = JSON.stringify({ ...report, schemaVersion: 2 });
  assert.throws(() => parseEvidenceReport(unsupported), /unsupported evidence schemaVersion/);
});
