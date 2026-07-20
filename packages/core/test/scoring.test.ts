import assert from "node:assert/strict";
import test from "node:test";

import { summarizeBenchmarkSamples } from "../src/metrics/metrics.ts";
import { scoreHttpsNetwork } from "../src/scoring/scoring.ts";

function metrics(durations: readonly number[], failures = 0) {
  return summarizeBenchmarkSamples([
    ...durations.map((durationMs) => ({
      status: "success" as const,
      durationMs
    })),
    ...Array.from({ length: failures }, () => ({
      status: "timeout" as const,
      durationMs: 7_000
    }))
  ]);
}

test("excellent HTTPS conditions can reach 100", () => {
  const result = scoreHttpsNetwork({
    metrics: metrics([100, 110, 120, 115]),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });

  assert.equal(result.score, 100);
  assert.equal(result.rawScore, 100);
  assert.equal(result.grade, "excellent");
  assert.equal(result.confidence, "browser-basic");
  assert.deepEqual(result.unverifiedDimensions, ["realtime", "real-tool"]);
});

test("any completed request failure caps the score at 79", () => {
  const result = scoreHttpsNetwork({
    metrics: metrics(Array.from({ length: 99 }, () => 100), 1),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });

  assert.equal(result.rawScore, 100);
  assert.equal(result.score, 79);
  assert.ok(result.capsApplied.some((cap) => cap.id === "request-failure"));
});

test("success below 95 percent caps the score at 59", () => {
  const result = scoreHttpsNetwork({
    metrics: metrics(Array.from({ length: 94 }, () => 100), 6),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });

  assert.equal(result.score, 59);
  assert.ok(result.capsApplied.some((cap) => cap.id === "success-below-95"));
});

test("success below 85 percent caps the score at 39", () => {
  const result = scoreHttpsNetwork({
    metrics: metrics(Array.from({ length: 84 }, () => 100), 16),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });

  assert.equal(result.score, 39);
  assert.equal(result.grade, "critical");
  assert.ok(result.capsApplied.some((cap) => cap.id === "success-below-85"));
});

test("an unreachable primary endpoint caps the score at 20", () => {
  const result = scoreHttpsNetwork({
    metrics: metrics([100, 110, 120]),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: false
  });

  assert.equal(result.score, 20);
  assert.ok(result.capsApplied.some((cap) => cap.id === "primary-unreachable"));
});

test("no completed samples produces a zero score without inventing latency", () => {
  const result = scoreHttpsNetwork({
    metrics: summarizeBenchmarkSamples([
      { status: "cancelled", durationMs: 10 }
    ]),
    criticalEndpointCoverage: 0,
    primaryEndpointReachable: false
  });

  assert.equal(result.rawScore, 0);
  assert.equal(result.score, 0);
  assert.equal(result.dimensions[0]?.measuredValue, null);
  assert.equal(result.dimensions[1]?.measuredValue, null);
});

test("latency and jitter degrade their own dimensions", () => {
  const result = scoreHttpsNetwork({
    metrics: metrics([100, 1_900, 100, 1_900]),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });

  const p95 = result.dimensions.find((dimension) => dimension.id === "p95-latency");
  const average = result.dimensions.find(
    (dimension) => dimension.id === "average-latency"
  );
  const jitter = result.dimensions.find((dimension) => dimension.id === "jitter");

  assert.ok((p95?.score ?? 25) < 10);
  assert.ok((average?.score ?? 15) < 5);
  assert.equal(jitter?.score, 0);
  assert.ok(result.score < 80);
});

test("critical endpoint coverage contributes at most ten points", () => {
  const full = scoreHttpsNetwork({
    metrics: metrics([100, 110]),
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });
  const half = scoreHttpsNetwork({
    metrics: metrics([100, 110]),
    criticalEndpointCoverage: 0.5,
    primaryEndpointReachable: true
  });

  assert.equal(full.rawScore - half.rawScore, 5);
});

test("coverage outside zero and one is rejected", () => {
  assert.throws(
    () =>
      scoreHttpsNetwork({
        metrics: metrics([100]),
        criticalEndpointCoverage: 1.01,
        primaryEndpointReachable: true
      }),
    RangeError
  );
});
