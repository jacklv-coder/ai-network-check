import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeBenchmarkSamples,
  type AIServiceDefinition,
  type BenchmarkSample,
  type ServiceEndpoint
} from "../../core/src/index.ts";
import type {
  BrowserEndpointBenchmarkInput,
  BrowserEndpointBenchmarkResult,
  BrowserProbeSample
} from "../../web-benchmark/src/index.ts";
import {
  resolveWebBenchmarkWorkflowOptions,
  runWebBenchmarkWorkflow,
  WebBenchmarkWorkflowCancelledError,
  type WebBenchmarkWorkflowProgress
} from "../src/index.ts";

const openAIService: AIServiceDefinition = {
  id: "openai",
  provider: "openai",
  displayName: "OpenAI",
  products: ["chatgpt"],
  capabilities: ["browser-https"],
  limitations: ["http-status-unverified"],
  endpoints: [
    {
      id: "openai-chatgpt",
      label: "ChatGPT",
      url: "https://chatgpt.com/",
      role: "primary",
      critical: true,
      browserRequestMode: "no-cors"
    },
    {
      id: "openai-api",
      label: "OpenAI API",
      url: "https://api.openai.com/",
      role: "api",
      critical: true,
      browserRequestMode: "no-cors"
    },
    {
      id: "openai-static",
      label: "Static",
      url: "https://oaistatic.com/",
      role: "static",
      critical: false,
      browserRequestMode: "cors"
    }
  ]
};

const anthropicService: AIServiceDefinition = {
  id: "anthropic",
  provider: "anthropic",
  displayName: "Anthropic",
  products: ["claude"],
  capabilities: ["browser-https"],
  limitations: ["http-status-unverified"],
  endpoints: [
    {
      id: "anthropic-claude",
      label: "Claude",
      url: "https://claude.ai/",
      role: "primary",
      critical: true,
      browserRequestMode: "no-cors"
    }
  ]
};

function makeSamples(
  count: number,
  status: BenchmarkSample["status"] = "success"
): readonly BrowserProbeSample[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    status,
    durationMs: 100 + index,
    httpStatus: status === "success" ? 200 : null
  }));
}

function resultFor(
  endpoint: ServiceEndpoint,
  count: number,
  status: BenchmarkSample["status"] = "success",
  cancelled = false
): BrowserEndpointBenchmarkResult {
  const samples = makeSamples(count, status);
  return {
    endpointId: endpoint.id,
    samples,
    metrics: summarizeBenchmarkSamples(samples),
    cancelled,
    httpStatusVerification:
      endpoint.browserRequestMode === "no-cors" ? "unverified" : "verified"
  };
}

function fixedNow(...timestamps: readonly string[]): () => Date {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]!);
}

test("orchestrates endpoints, scores the primary path, and builds a web report", async () => {
  const calls: BrowserEndpointBenchmarkInput[] = [];
  const report = await runWebBenchmarkWorkflow(
    {
      serviceIds: ["openai"],
      route: "  LA 01  ",
      primarySampleCount: 4,
      supportingSampleCount: 2,
      timeoutMs: 5_000,
      delayMs: 25
    },
    {
      listServices: () => [openAIService, anthropicService],
      now: fixedNow("2026-07-20T10:00:00.000Z", "2026-07-20T10:00:10.000Z"),
      runEndpointBenchmark: async (input) => {
        calls.push(input);
        return resultFor(input.endpoint, input.options.sampleCount);
      }
    }
  );

  assert.deepEqual(
    calls.map((call) => [call.endpoint.id, call.options.sampleCount]),
    [
      ["openai-chatgpt", 4],
      ["openai-api", 2],
      ["openai-static", 2]
    ]
  );
  assert.equal(report.mode, "web");
  assert.equal(report.confidence, "browser-basic");
  assert.equal(report.route, "LA 01");
  assert.equal(report.startedAt, "2026-07-20T10:00:00.000Z");
  assert.equal(report.completedAt, "2026-07-20T10:00:10.000Z");
  assert.equal(report.services[0]?.criticalEndpointCoverage, 1);
  assert.equal(report.services[0]?.endpoints.length, 3);
  assert.ok(report.services[0]?.score);
  assert.deepEqual(report.limitations, [
    "network-phases-unverified",
    "websocket-unverified",
    "real-tool-unverified",
    "http-status-unverified"
  ]);
});

test("calculates critical coverage independently from the primary endpoint", async () => {
  const report = await runWebBenchmarkWorkflow(
    { serviceIds: ["openai"], primarySampleCount: 2, supportingSampleCount: 1 },
    {
      listServices: () => [openAIService],
      now: fixedNow("2026-07-20T10:00:00.000Z", "2026-07-20T10:00:01.000Z"),
      runEndpointBenchmark: async (input) =>
        input.endpoint.id === "openai-api"
          ? resultFor(input.endpoint, input.options.sampleCount, "timeout")
          : resultFor(input.endpoint, input.options.sampleCount)
    }
  );

  assert.equal(report.services[0]?.primaryEndpointReachable, true);
  assert.equal(report.services[0]?.criticalEndpointCoverage, 0.5);
});

test("preserves requested service order and defaults to the full catalog", async () => {
  const dependencies = {
    listServices: () => [openAIService, anthropicService],
    now: fixedNow(
      "2026-07-20T10:00:00.000Z",
      "2026-07-20T10:00:01.000Z",
      "2026-07-20T10:00:02.000Z",
      "2026-07-20T10:00:03.000Z"
    ),
    runEndpointBenchmark: async (input: BrowserEndpointBenchmarkInput) =>
      resultFor(input.endpoint, input.options.sampleCount)
  };

  const selected = await runWebBenchmarkWorkflow(
    { serviceIds: ["anthropic", "openai"], primarySampleCount: 1, supportingSampleCount: 1 },
    dependencies
  );
  assert.deepEqual(selected.services.map((service) => service.serviceId), [
    "anthropic",
    "openai"
  ]);

  const all = await runWebBenchmarkWorkflow(
    { primarySampleCount: 1, supportingSampleCount: 1 },
    dependencies
  );
  assert.deepEqual(all.services.map((service) => service.serviceId), [
    "openai",
    "anthropic"
  ]);
});

test("emits workflow, service, endpoint, sample, and completion progress", async () => {
  const events: WebBenchmarkWorkflowProgress[] = [];
  await runWebBenchmarkWorkflow(
    {
      serviceIds: ["anthropic"],
      primarySampleCount: 1,
      onProgress: (event) => events.push(event)
    },
    {
      listServices: () => [anthropicService],
      now: fixedNow("2026-07-20T10:00:00.000Z", "2026-07-20T10:00:01.000Z"),
      runEndpointBenchmark: async (input) => {
        const result = resultFor(input.endpoint, 1);
        input.options.onProgress?.({
          endpointId: input.endpoint.id,
          completedSamples: 1,
          totalSamples: 1,
          latestSample: result.samples[0]!,
          metrics: result.metrics
        });
        return result;
      }
    }
  );

  assert.deepEqual(events.map((event) => event.type), [
    "workflow-start",
    "service-start",
    "endpoint-start",
    "endpoint-progress",
    "endpoint-complete",
    "service-complete",
    "workflow-complete"
  ]);
});

test("rejects unknown, duplicate, empty, and invalid workflow options", () => {
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({ serviceIds: ["missing"] }, [openAIService]),
    /Unknown service id/
  );
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({ serviceIds: ["openai", "openai"] }, [openAIService]),
    /unique/
  );
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({ serviceIds: [] }, [openAIService]),
    /at least one/
  );
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({ primarySampleCount: 0 }, [openAIService]),
    /positive integer/
  );
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({ timeoutMs: 0 }, [openAIService]),
    /greater than zero/
  );
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({ delayMs: -1 }, [openAIService]),
    /non-negative/
  );
});

test("rejects an empty default catalog", () => {
  assert.throws(
    () => resolveWebBenchmarkWorkflowOptions({}, []),
    /catalog must not be empty/
  );
});

test("stops before network work when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;

  await assert.rejects(
    runWebBenchmarkWorkflow(
      { serviceIds: ["anthropic"], signal: controller.signal },
      {
        listServices: () => [anthropicService],
        runEndpointBenchmark: async (input) => {
          called = true;
          return resultFor(input.endpoint, 1);
        }
      }
    ),
    (error: unknown) =>
      error instanceof WebBenchmarkWorkflowCancelledError && error.name === "AbortError"
  );
  assert.equal(called, false);
});

test("does not create a partial report when an endpoint benchmark is cancelled", async () => {
  await assert.rejects(
    runWebBenchmarkWorkflow(
      { serviceIds: ["anthropic"] },
      {
        listServices: () => [anthropicService],
        runEndpointBenchmark: async (input) =>
          resultFor(input.endpoint, 1, "cancelled", true)
      }
    ),
    WebBenchmarkWorkflowCancelledError
  );
});
