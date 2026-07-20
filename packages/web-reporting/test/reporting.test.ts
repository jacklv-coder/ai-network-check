import assert from "node:assert/strict";
import test from "node:test";

import type { BenchmarkReport, HttpsNetworkScore } from "../../core/src/index.ts";
import {
  aggregateRouteHistory,
  clearReportHistory,
  createJsonReportExport,
  createReportFingerprint,
  createTextReportExport,
  readReportHistory,
  removeReportFromHistory,
  saveReportToHistory
} from "../src/index.ts";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function score(value: number, grade: HttpsNetworkScore["grade"] = "good"): HttpsNetworkScore {
  return {
    kind: "ai-https-network",
    confidence: "browser-basic",
    score: value,
    rawScore: value,
    grade,
    dimensions: [],
    capsApplied: [],
    unverifiedDimensions: ["realtime", "real-tool"]
  };
}

function report(
  completedAt: string,
  route: string | null,
  serviceId = "openai",
  serviceScore = 90
): BenchmarkReport {
  return {
    schemaVersion: 1,
    mode: "web",
    confidence: "browser-basic",
    route,
    startedAt: new Date(Date.parse(completedAt) - 1_000).toISOString(),
    completedAt,
    services: [
      {
        serviceId,
        primaryEndpointReachable: true,
        criticalEndpointCoverage: 1,
        endpoints: [
          {
            endpointId: `${serviceId}-primary`,
            httpStatusVerification: "unverified",
            samples: [{ status: "success", durationMs: 120 }],
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
                minMs: 120,
                maxMs: 120,
                averageMs: 120,
                p50Ms: 120,
                p95Ms: 120,
                p99Ms: 120,
                standardDeviationMs: 0,
                jitterMs: 0
              }
            }
          }
        ],
        score: score(serviceScore, serviceScore >= 90 ? "excellent" : "good")
      }
    ],
    limitations: ["http-status-unverified", "websocket-unverified"]
  };
}

test("saves, sorts, and limits report history", () => {
  const storage = new MemoryStorage();
  const older = report("2026-07-20T10:00:00.000Z", "LA");
  const newer = report("2026-07-20T11:00:00.000Z", "SG");

  saveReportToHistory(storage, older, { limit: 2 });
  const saved = saveReportToHistory(storage, newer, { limit: 2 });

  assert.deepEqual(saved.map((item) => item.route), ["SG", "LA"]);
  assert.deepEqual(readReportHistory(storage).map((item) => item.route), ["SG", "LA"]);
});

test("deduplicates reports by deterministic fingerprint", () => {
  const storage = new MemoryStorage();
  const item = report("2026-07-20T10:00:00.000Z", "LA");

  saveReportToHistory(storage, item);
  const saved = saveReportToHistory(storage, item);

  assert.equal(saved.length, 1);
  assert.equal(createReportFingerprint(saved[0]!), createReportFingerprint(item));
});

test("recovers valid entries from a partially damaged envelope", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "ai-network-check:report-history:v1",
    JSON.stringify({
      schemaVersion: 1,
      reports: [
        { schemaVersion: 999 },
        report("2026-07-20T10:00:00.000Z", "LA")
      ]
    })
  );

  const reports = readReportHistory(storage);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.route, "LA");
});

test("returns an empty history for malformed storage and validates limits", () => {
  const storage = new MemoryStorage();
  storage.setItem("ai-network-check:report-history:v1", "not json");

  assert.deepEqual(readReportHistory(storage), []);
  assert.throws(() => readReportHistory(storage, { limit: 0 }), /positive integer/);
});

test("removes individual reports and clears the configured key", () => {
  const storage = new MemoryStorage();
  const la = report("2026-07-20T10:00:00.000Z", "LA");
  const sg = report("2026-07-20T11:00:00.000Z", "SG");
  saveReportToHistory(storage, la);
  saveReportToHistory(storage, sg);

  const remaining = removeReportFromHistory(storage, createReportFingerprint(sg));
  assert.deepEqual(remaining.map((item) => item.route), ["LA"]);

  clearReportHistory(storage);
  assert.deepEqual(readReportHistory(storage), []);
});

test("aggregates route score history and ignores unnamed routes", () => {
  const reports = [
    report("2026-07-20T12:00:00.000Z", "LA", "openai", 96),
    report("2026-07-20T11:00:00.000Z", "LA", "openai", 84),
    report("2026-07-20T13:00:00.000Z", "SG", "openai", 88),
    report("2026-07-20T14:00:00.000Z", null, "openai", 100)
  ];

  const routes = aggregateRouteHistory(reports);
  assert.deepEqual(routes.map((item) => item.route), ["SG", "LA"]);
  assert.equal(routes[1]?.reportCount, 2);
  assert.equal(routes[1]?.services[0]?.averageScore, 90);
  assert.equal(routes[1]?.services[0]?.latestScore, 96);
});

test("creates portable JSON and readable text exports", () => {
  const item = report("2026-07-20T10:00:00.000Z", "LA Premium", "openai", 95);
  const json = createJsonReportExport(item);
  const text = createTextReportExport(item);

  assert.match(json.filename, /^ai-network-check-la-premium-/);
  assert.equal(JSON.parse(json.content).route, "LA Premium");
  assert.match(text.content, /openai: 95\/100/);
  assert.match(text.content, /Success rate: 100%/);
  assert.match(text.content, /P95: 120 ms/);
  assert.match(text.content, /websocket-unverified/);
});

test("rejects invalid reports before writing history", () => {
  const storage = new MemoryStorage();
  const invalid = { ...report("2026-07-20T10:00:00.000Z", "LA"), schemaVersion: 2 };

  assert.throws(
    () => saveReportToHistory(storage, invalid as unknown as BenchmarkReport),
    /Invalid benchmark report/
  );
  assert.equal(storage.values.size, 0);
});
