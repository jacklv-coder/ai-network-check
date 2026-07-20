import assert from "node:assert/strict";
import test from "node:test";

import {
  averageServiceScore,
  createInitialWebAppState,
  reduceWebAppState
} from "../src/state.ts";
import type { BenchmarkReport } from "@ai-network-check/core";

function reportWithScores(scores: readonly (number | null)[]): BenchmarkReport {
  return {
    schemaVersion: 1,
    mode: "web",
    confidence: "browser-basic",
    route: null,
    startedAt: "2026-07-20T00:00:00.000Z",
    completedAt: "2026-07-20T00:00:01.000Z",
    limitations: [],
    services: scores.map((score, index) => ({
      serviceId: `service-${index}`,
      primaryEndpointReachable: true,
      criticalEndpointCoverage: 1,
      endpoints: [],
      score:
        score === null
          ? null
          : {
              kind: "ai-https-network",
              confidence: "browser-basic",
              score,
              rawScore: score,
              grade: "good",
              dimensions: [],
              capsApplied: [],
              unverifiedDimensions: ["realtime", "real-tool"]
            }
    }))
  };
}

test("initial state is idle with recommended sample count", () => {
  const state = createInitialWebAppState();
  assert.equal(state.phase, "idle");
  assert.equal(state.configuration.primarySampleCount, 20);
});

test("configuration can be updated while idle", () => {
  const state = reduceWebAppState(createInitialWebAppState(), {
    type: "configure",
    configuration: { route: "LA-01", selectedServiceIds: ["openai"] }
  });
  assert.equal(state.configuration.route, "LA-01");
  assert.deepEqual(state.configuration.selectedServiceIds, ["openai"]);
});

test("configuration is locked while running", () => {
  const running = reduceWebAppState(createInitialWebAppState(), { type: "start" });
  const unchanged = reduceWebAppState(running, {
    type: "configure",
    configuration: { route: "changed" }
  });
  assert.equal(unchanged, running);
});

test("progress is normalized and clamped", () => {
  const state = reduceWebAppState(createInitialWebAppState(), {
    type: "progress",
    label: "ChatGPT",
    completed: 12,
    total: 10
  });
  assert.equal(state.phase, "running");
  assert.equal(state.progress?.ratio, 1);
  assert.equal(state.progress?.completed, 10);
});

test("completion stores the report", () => {
  const report = reportWithScores([91]);
  const state = reduceWebAppState(createInitialWebAppState(), {
    type: "complete",
    report
  });
  assert.equal(state.phase, "result");
  assert.equal(state.report, report);
});

test("failure trims a message and reset preserves configuration", () => {
  const configured = reduceWebAppState(createInitialWebAppState(), {
    type: "configure",
    configuration: { route: "SG-01" }
  });
  const failed = reduceWebAppState(configured, { type: "fail", message: " timeout " });
  assert.equal(failed.errorMessage, "timeout");
  const reset = reduceWebAppState(failed, { type: "reset" });
  assert.equal(reset.phase, "idle");
  assert.equal(reset.configuration.route, "SG-01");
});

test("average score ignores unscored services", () => {
  assert.equal(averageServiceScore(reportWithScores([90, null, 80])), 85);
  assert.equal(averageServiceScore(reportWithScores([null])), null);
});
