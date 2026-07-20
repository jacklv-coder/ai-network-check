import assert from "node:assert/strict";
import test from "node:test";

import {
  buildServiceResultViewModels,
  createSparklinePoints,
  renderResultDetails
} from "../src/result-view.ts";
import type { AIServiceDefinition, BenchmarkReport } from "@ai-network-check/core";

const definitions: AIServiceDefinition[] = [
  {
    id: "openai",
    provider: "openai",
    displayName: "OpenAI",
    products: ["chatgpt"],
    capabilities: ["browser-https"],
    limitations: ["opaque-response"],
    endpoints: [
      {
        id: "chatgpt",
        label: "ChatGPT",
        url: "https://chatgpt.com/",
        role: "primary",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "api",
        label: "OpenAI API",
        url: "https://api.openai.com/",
        role: "api",
        critical: true,
        browserRequestMode: "no-cors"
      }
    ]
  }
];

const report: BenchmarkReport = {
  schemaVersion: 1,
  mode: "web",
  confidence: "browser-basic",
  route: "LA-01",
  startedAt: "2026-07-20T00:00:00.000Z",
  completedAt: "2026-07-20T00:00:02.000Z",
  limitations: ["websocket-unverified", "real-tool-unverified"],
  services: [
    {
      serviceId: "openai",
      primaryEndpointReachable: true,
      criticalEndpointCoverage: 0.5,
      score: {
        kind: "ai-https-network",
        confidence: "browser-basic",
        score: 93,
        rawScore: 93,
        grade: "excellent",
        dimensions: [],
        capsApplied: [],
        unverifiedDimensions: ["realtime", "real-tool"]
      },
      endpoints: [
        {
          endpointId: "chatgpt",
          httpStatusVerification: "unverified",
          samples: [
            { status: "success", durationMs: 100 },
            { status: "success", durationMs: 200 }
          ],
          metrics: {
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
              minMs: 100,
              maxMs: 200,
              averageMs: 150,
              p50Ms: 150,
              p95Ms: 195,
              p99Ms: 199,
              standardDeviationMs: 50,
              jitterMs: 100
            }
          }
        },
        {
          endpointId: "api",
          httpStatusVerification: "unverified",
          samples: [{ status: "timeout", durationMs: 7000 }],
          metrics: {
            totalCount: 1,
            completedCount: 1,
            successCount: 0,
            failureCount: 1,
            cancelledCount: 0,
            timeoutCount: 1,
            networkErrorCount: 0,
            protocolErrorCount: 0,
            successRate: 0,
            latency: null
          }
        }
      ]
    }
  ]
};

test("builds service and primary endpoint models", () => {
  const models = buildServiceResultViewModels(report, definitions);
  assert.equal(models[0]?.name, "OpenAI");
  assert.equal(models[0]?.primary?.label, "ChatGPT");
  assert.equal(models[0]?.score, 93);
});

test("classifies endpoint states", () => {
  const endpoints = buildServiceResultViewModels(report, definitions)[0]?.endpoints;
  assert.equal(endpoints?.[0]?.status, "good");
  assert.equal(endpoints?.[1]?.status, "bad");
});

test("creates bounded sparkline points", () => {
  const points = createSparklinePoints([
    { status: "success", durationMs: 100 },
    { status: "success", durationMs: 300 }
  ]);
  assert.equal(points, "6.0,66.0 254.0,6.0");
});

test("returns an empty sparkline without successes", () => {
  assert.equal(createSparklinePoints([{ status: "timeout", durationMs: 7000 }]), "");
});

test("renders service metrics and verification limits", () => {
  const html = renderResultDetails(report, definitions);
  assert.match(html, /OpenAI/);
  assert.match(html, /195 ms/);
  assert.match(html, /未验证 AI 服务内部 WebSocket/);
});

test("escapes unknown service identifiers", () => {
  const unsafe: BenchmarkReport = {
    ...report,
    services: [{ ...report.services[0]!, serviceId: "<script>" }]
  };
  const html = renderResultDetails(unsafe, []);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
