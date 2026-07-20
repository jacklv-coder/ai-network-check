import assert from "node:assert/strict";
import test from "node:test";

import { summarizeBenchmarkSamples } from "../src/metrics/metrics.ts";
import {
  createBenchmarkReport,
  createEndpointBenchmarkReport,
  parseBenchmarkReport,
  serializeBenchmarkReport,
  validateBenchmarkReport
} from "../src/report/report.ts";
import { scoreHttpsNetwork } from "../src/scoring/scoring.ts";

const startedAt = "2026-07-20T10:00:00.000Z";
const completedAt = "2026-07-20T10:00:10.000Z";

function endpointReport() {
  return createEndpointBenchmarkReport({
    endpointId: "openai-chatgpt",
    httpStatusVerification: "unverified",
    samples: [
      { status: "success", durationMs: 100 },
      { status: "success", durationMs: 120 }
    ]
  });
}

function serviceReport() {
  const endpoint = endpointReport();
  const score = scoreHttpsNetwork({
    metrics: endpoint.metrics,
    criticalEndpointCoverage: 1,
    primaryEndpointReachable: true
  });

  return {
    serviceId: "openai",
    primaryEndpointReachable: true,
    criticalEndpointCoverage: 1,
    endpoints: [endpoint],
    score
  } as const;
}

test("endpoint report derives metrics from its samples", () => {
  const endpoint = endpointReport();

  assert.equal(endpoint.metrics.successRate, 1);
  assert.equal(endpoint.metrics.latency?.averageMs, 110);
  assert.notEqual(endpoint.samples[0], endpoint.samples[1]);
});

test("report builder adds schema version and normalizes route", () => {
  const report = createBenchmarkReport({
    mode: "web",
    confidence: "browser-basic",
    route: "  Los Angeles 01  ",
    startedAt,
    completedAt,
    services: [serviceReport()],
    limitations: [
      "websocket-unverified",
      "real-tool-unverified",
      "websocket-unverified"
    ]
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.route, "Los Angeles 01");
  assert.deepEqual(report.limitations, [
    "websocket-unverified",
    "real-tool-unverified"
  ]);
});

test("mode and confidence must be compatible", () => {
  assert.throws(
    () =>
      createBenchmarkReport({
        mode: "web",
        confidence: "local-network",
        startedAt,
        completedAt,
        services: [],
        limitations: []
      }),
    /incompatible/
  );
});

test("report rejects reversed time ranges", () => {
  assert.throws(
    () =>
      createBenchmarkReport({
        mode: "web",
        confidence: "browser-basic",
        startedAt: completedAt,
        completedAt: startedAt,
        services: [],
        limitations: []
      }),
    /earlier/
  );
});

test("service and endpoint ids must be unique", () => {
  const service = serviceReport();

  assert.throws(
    () =>
      createBenchmarkReport({
        mode: "web",
        confidence: "browser-basic",
        startedAt,
        completedAt,
        services: [service, service],
        limitations: []
      }),
    /service ids must be unique/
  );

  assert.throws(
    () =>
      createBenchmarkReport({
        mode: "web",
        confidence: "browser-basic",
        startedAt,
        completedAt,
        services: [
          {
            ...service,
            endpoints: [service.endpoints[0], service.endpoints[0]]
          }
        ],
        limitations: []
      }),
    /endpoint ids/
  );
});

test("service score confidence must match the report", () => {
  const service = serviceReport();

  assert.throws(
    () =>
      createBenchmarkReport({
        mode: "web",
        confidence: "browser-realtime",
        startedAt,
        completedAt,
        services: [service],
        limitations: []
      }),
    /score confidence/
  );
});

test("serialized reports round-trip through parser", () => {
  const report = createBenchmarkReport({
    mode: "web",
    confidence: "browser-basic",
    startedAt,
    completedAt,
    services: [serviceReport()],
    limitations: ["http-status-unverified", "websocket-unverified"]
  });
  const parsed = parseBenchmarkReport(serializeBenchmarkReport(report));

  assert.deepEqual(parsed, report);
  assert.deepEqual(validateBenchmarkReport(parsed), []);
});

test("parser rejects malformed JSON and unsupported versions", () => {
  assert.throws(() => parseBenchmarkReport("{"), SyntaxError);

  const invalid = {
    schemaVersion: 2,
    mode: "web",
    confidence: "browser-basic",
    route: null,
    startedAt,
    completedAt,
    services: [],
    limitations: []
  };

  assert.throws(
    () => parseBenchmarkReport(JSON.stringify(invalid)),
    /unsupported schemaVersion/
  );
});

test("validator catches invalid sample fields", () => {
  const endpoint = endpointReport();
  const service = serviceReport();
  const invalid = {
    schemaVersion: 1,
    mode: "web",
    confidence: "browser-basic",
    route: null,
    startedAt,
    completedAt,
    limitations: [],
    services: [
      {
        ...service,
        endpoints: [
          {
            ...endpoint,
            samples: [{ status: "mystery", durationMs: -1 }],
            metrics: summarizeBenchmarkSamples([])
          }
        ]
      }
    ]
  };

  const errors = validateBenchmarkReport(invalid);

  assert.ok(errors.some((error) => error.includes("status is invalid")));
  assert.ok(errors.some((error) => error.includes("durationMs is invalid")));
});
