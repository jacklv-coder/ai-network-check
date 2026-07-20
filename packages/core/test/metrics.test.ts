import assert from "node:assert/strict";
import test from "node:test";

import {
  average,
  meanAbsoluteSuccessiveDifference,
  percentile,
  populationStandardDeviation,
  summarizeBenchmarkSamples,
  summarizeLatency
} from "../src/metrics/metrics.ts";

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

test("average and percentile return null for empty input", () => {
  assert.equal(average([]), null);
  assert.equal(percentile([], 0.95), null);
});

test("percentile uses linear interpolation without mutating input", () => {
  const values = [40, 10, 30, 20];

  closeTo(percentile(values, 0.5) ?? Number.NaN, 25);
  closeTo(percentile(values, 0.95) ?? Number.NaN, 38.5);
  assert.deepEqual(values, [40, 10, 30, 20]);
});

test("percentile rejects quantiles outside zero and one", () => {
  assert.throws(() => percentile([1], -0.01), RangeError);
  assert.throws(() => percentile([1], 1.01), RangeError);
});

test("population standard deviation is calculated for the full sample", () => {
  closeTo(populationStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9]) ?? Number.NaN, 2);
});

test("jitter is the mean absolute difference between consecutive samples", () => {
  closeTo(meanAbsoluteSuccessiveDifference([100, 130, 90, 110]) ?? Number.NaN, 30);
  assert.equal(meanAbsoluteSuccessiveDifference([100]), 0);
});

test("latency summary includes percentile, spread, and jitter metrics", () => {
  const summary = summarizeLatency([100, 120, 140, 160]);

  assert.ok(summary);
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.minMs, 100);
  assert.equal(summary.maxMs, 160);
  assert.equal(summary.averageMs, 130);
  assert.equal(summary.p50Ms, 130);
  closeTo(summary.p95Ms, 157);
  closeTo(summary.p99Ms, 159.4);
  closeTo(summary.jitterMs, 20);
});

test("benchmark summary excludes cancelled samples from success rate", () => {
  const summary = summarizeBenchmarkSamples([
    { status: "success", durationMs: 100 },
    { status: "success", durationMs: 120 },
    { status: "timeout", durationMs: 7_000 },
    { status: "network-error", durationMs: 450 },
    { status: "protocol-error", durationMs: 300 },
    { status: "cancelled", durationMs: 20 }
  ]);

  assert.equal(summary.totalCount, 6);
  assert.equal(summary.completedCount, 5);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 3);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.timeoutCount, 1);
  assert.equal(summary.networkErrorCount, 1);
  assert.equal(summary.protocolErrorCount, 1);
  assert.equal(summary.successRate, 0.4);
  assert.deepEqual(summary.latency, {
    sampleCount: 2,
    minMs: 100,
    maxMs: 120,
    averageMs: 110,
    p50Ms: 110,
    p95Ms: 119,
    p99Ms: 119.8,
    standardDeviationMs: 10,
    jitterMs: 20
  });
});

test("an all-cancelled run has no completion rate or latency", () => {
  const summary = summarizeBenchmarkSamples([
    { status: "cancelled", durationMs: 10 }
  ]);

  assert.equal(summary.completedCount, 0);
  assert.equal(summary.successRate, null);
  assert.equal(summary.latency, null);
});

test("invalid durations are rejected before metrics are produced", () => {
  assert.throws(() => summarizeLatency([100, Number.NaN]), RangeError);
  assert.throws(
    () => summarizeBenchmarkSamples([{ status: "success", durationMs: -1 }]),
    RangeError
  );
});
