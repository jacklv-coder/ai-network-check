import assert from "node:assert/strict";
import test from "node:test";

import type { ServiceEndpoint } from "../../core/src/index.ts";
import {
  createBrowserProbeUrl,
  runBrowserEndpointBenchmark
} from "../src/index.ts";

function endpoint(
  browserRequestMode: ServiceEndpoint["browserRequestMode"] = "no-cors"
): ServiceEndpoint {
  return {
    id: "test-endpoint",
    label: "Test Endpoint",
    url: "https://example.com/path?existing=1",
    role: "primary",
    critical: true,
    browserRequestMode
  };
}

function response(ok: boolean, status: number): Response {
  return { ok, status } as Response;
}

test("probe URL preserves existing query parameters and replaces cache token", () => {
  const first = new URL(createBrowserProbeUrl(endpoint().url, "first"));
  const second = new URL(createBrowserProbeUrl(first.toString(), "second"));

  assert.equal(first.searchParams.get("existing"), "1");
  assert.equal(first.searchParams.get("__anc_probe"), "first");
  assert.equal(second.searchParams.get("__anc_probe"), "second");
  assert.equal(second.searchParams.getAll("__anc_probe").length, 1);
});

test("successful samples emit progress and aggregate latency metrics", async () => {
  const observedUrls: string[] = [];
  const progress: number[] = [];
  const times = [0, 125, 200, 350];

  const result = await runBrowserEndpointBenchmark({
    endpoint: endpoint("cors"),
    options: {
      sampleCount: 2,
      timeoutMs: 1_000,
      onProgress: (event) => progress.push(event.completedSamples)
    },
    dependencies: {
      fetch: (async (url) => {
        observedUrls.push(String(url));
        return response(true, 204);
      }) as typeof fetch,
      now: () => times.shift() ?? 350,
      createCacheBustToken: (index) => `sample-${index}`
    }
  });

  assert.deepEqual(progress, [1, 2]);
  assert.equal(observedUrls.length, 2);
  assert.equal(
    new URL(observedUrls[0] ?? "").searchParams.get("__anc_probe"),
    "sample-0"
  );
  assert.equal(result.httpStatusVerification, "verified");
  assert.deepEqual(
    result.samples.map((sample) => [
      sample.status,
      sample.durationMs,
      sample.httpStatus
    ]),
    [
      ["success", 125, 204],
      ["success", 150, 204]
    ]
  );
  assert.equal(result.metrics.successRate, 1);
  assert.equal(result.metrics.latency?.averageMs, 137.5);
});

test("a non-ok CORS response is a protocol error", async () => {
  const result = await runBrowserEndpointBenchmark({
    endpoint: endpoint("cors"),
    options: { sampleCount: 1, timeoutMs: 1_000 },
    dependencies: {
      fetch: (async () => response(false, 503)) as typeof fetch,
      now: (() => {
        const times = [0, 50];
        return () => times.shift() ?? 50;
      })()
    }
  });

  assert.equal(result.samples[0]?.status, "protocol-error");
  assert.equal(result.samples[0]?.httpStatus, 503);
  assert.equal(result.metrics.protocolErrorCount, 1);
});

test("an opaque no-cors response counts as connectivity success", async () => {
  const result = await runBrowserEndpointBenchmark({
    endpoint: endpoint("no-cors"),
    options: { sampleCount: 1, timeoutMs: 1_000 },
    dependencies: {
      fetch: (async () => response(false, 0)) as typeof fetch,
      now: (() => {
        const times = [0, 40];
        return () => times.shift() ?? 40;
      })()
    }
  });

  assert.equal(result.samples[0]?.status, "success");
  assert.equal(result.samples[0]?.httpStatus, null);
  assert.equal(result.httpStatusVerification, "unverified");
});

test("fetch rejection is classified as a network error", async () => {
  const result = await runBrowserEndpointBenchmark({
    endpoint: endpoint(),
    options: { sampleCount: 1, timeoutMs: 1_000 },
    dependencies: {
      fetch: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
      now: (() => {
        const times = [0, 30];
        return () => times.shift() ?? 30;
      })()
    }
  });

  assert.equal(result.samples[0]?.status, "network-error");
  assert.equal(result.metrics.networkErrorCount, 1);
});

test("per-sample timeout aborts a hanging request", async () => {
  const result = await runBrowserEndpointBenchmark({
    endpoint: endpoint(),
    options: { sampleCount: 1, timeoutMs: 5 },
    dependencies: {
      fetch: ((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })) as typeof fetch
    }
  });

  assert.equal(result.samples[0]?.status, "timeout");
  assert.equal(result.metrics.timeoutCount, 1);
});

test("caller cancellation stops the run and reports a cancelled sample", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);

  const result = await runBrowserEndpointBenchmark({
    endpoint: endpoint(),
    options: {
      sampleCount: 3,
      timeoutMs: 100,
      signal: controller.signal
    },
    dependencies: {
      fetch: ((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })) as typeof fetch
    }
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0]?.status, "cancelled");
  assert.equal(result.metrics.cancelledCount, 1);
  assert.equal(result.metrics.completedCount, 0);
});

test("invalid benchmark options are rejected", async () => {
  await assert.rejects(
    runBrowserEndpointBenchmark({
      endpoint: endpoint(),
      options: { sampleCount: 0, timeoutMs: 1_000 }
    }),
    RangeError
  );
  await assert.rejects(
    runBrowserEndpointBenchmark({
      endpoint: endpoint(),
      options: { sampleCount: 1, timeoutMs: 0 }
    }),
    RangeError
  );
  await assert.rejects(
    runBrowserEndpointBenchmark({
      endpoint: endpoint(),
      options: { sampleCount: 1, timeoutMs: 1_000, delayMs: -1 }
    }),
    RangeError
  );
});
