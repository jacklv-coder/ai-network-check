import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import type { AIServiceDefinition } from "../../../packages/core/src/index.ts";
import type {
  CodexBenchmarkResult
} from "../../../packages/cli-benchmark/src/index.ts";
import type {
  NetworkPhaseBenchmarkOptions,
  NetworkPhaseBenchmarkResult
} from "../../../packages/network-phase-benchmark/src/index.ts";
import { startAgentServer } from "../src/index.ts";

interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

function send(
  origin: string,
  path: string,
  options: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  } = {}
): Promise<HttpResponse> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: options.method ?? "GET", headers: options.headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body })
        );
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const service: AIServiceDefinition = {
  id: "openai",
  provider: "openai",
  displayName: "OpenAI",
  products: ["chatgpt", "openai-api", "codex"],
  capabilities: ["browser-https", "local-network-phases"],
  limitations: ["websocket-unverified", "real-tool-unverified"],
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
    }
  ]
};

function phaseResult(
  url: string,
  status: NetworkPhaseBenchmarkResult["status"] = "success"
): NetworkPhaseBenchmarkResult {
  return {
    url,
    hostname: new URL(url).hostname,
    status,
    resolvedAddress: status === "success" ? "203.0.113.10" : null,
    addressFamily: status === "success" ? 4 : null,
    httpStatus: status === "success" ? 200 : null,
    phases:
      status === "success"
        ? {
            dnsMs: 10,
            tcpMs: 20,
            tlsMs: 30,
            requestToFirstByteMs: 40,
            totalToFirstByteMs: 100
          }
        : null,
    errorCode: null
  };
}

function codexResult(): CodexBenchmarkResult {
  return {
    status: "success",
    inspection: {
      installed: true,
      authenticated: true,
      version: "codex 1"
    },
    durationMs: 100,
    firstEventMs: 10,
    firstAgentMessageMs: 50,
    exitCode: 0,
    responseMatched: true,
    sawTurnCompleted: true,
    eventCounts: {}
  };
}

test("advertises catalog-bound network phase capability", async (context) => {
  const agent = await startAgentServer({ port: 0, token: "a".repeat(32) });
  context.after(() => agent.close());

  const response = await send(agent.origin, "/v1/status", {
    headers: headers(agent.token)
  });
  const body = JSON.parse(response.body);
  assert.equal(body.capabilities.networkPhases, true);
  assert.equal(body.networkPhaseBenchmarkRunning, false);
});

test("runs only HTTPS endpoints from the selected service catalog entry", async (context) => {
  const calls: NetworkPhaseBenchmarkOptions[] = [];
  const agent = await startAgentServer(
    { port: 0, token: "b".repeat(32) },
    {
      listServices: () => [service],
      runNetworkPhaseBenchmark: async (options) => {
        calls.push(options);
        return phaseResult(options.url);
      }
    }
  );
  context.after(() => agent.close());

  const response = await send(
    agent.origin,
    "/v1/benchmarks/network-phases/openai",
    { method: "POST", headers: headers(agent.token) }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://chatgpt.com/", "https://api.openai.com/"]
  );
  assert.ok(calls.every((call) => call.timeoutMs === 15_000));

  const body = JSON.parse(response.body);
  assert.equal(body.source, "service-catalog");
  assert.equal(body.serviceId, "openai");
  assert.deepEqual(
    body.endpoints.map((item: { endpointId: string }) => item.endpointId),
    ["openai-chatgpt", "openai-api"]
  );
});

test("rejects unknown service IDs, nested paths, and request bodies", async (context) => {
  const agent = await startAgentServer(
    { port: 0, token: "c".repeat(32) },
    { listServices: () => [service] }
  );
  context.after(() => agent.close());

  assert.equal(
    (
      await send(
        agent.origin,
        "/v1/benchmarks/network-phases/unknown",
        { method: "POST", headers: headers(agent.token) }
      )
    ).status,
    404
  );
  assert.equal(
    (
      await send(
        agent.origin,
        "/v1/benchmarks/network-phases/openai/extra",
        { method: "POST", headers: headers(agent.token) }
      )
    ).status,
    404
  );
  const withBody = await send(
    agent.origin,
    "/v1/benchmarks/network-phases/openai",
    {
      method: "POST",
      headers: {
        ...headers(agent.token),
        "content-type": "application/json"
      },
      body: JSON.stringify({ url: "https://evil.example/" })
    }
  );
  assert.equal(withBody.status, 400);
  assert.equal(JSON.parse(withBody.body).error, "request-body-not-allowed");
});

test("reports running state and prevents overlap with Codex", async (context) => {
  let resolvePhase!: (value: NetworkPhaseBenchmarkResult) => void;
  const pending = new Promise<NetworkPhaseBenchmarkResult>((resolve) => {
    resolvePhase = resolve;
  });
  const agent = await startAgentServer(
    { port: 0, token: "d".repeat(32) },
    {
      listServices: () => [service],
      runNetworkPhaseBenchmark: async () => pending,
      runCodexBenchmark: async () => codexResult()
    }
  );
  context.after(() => agent.close());

  const active = send(
    agent.origin,
    "/v1/benchmarks/network-phases/openai",
    { method: "POST", headers: headers(agent.token) }
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  const status = JSON.parse(
    (
      await send(agent.origin, "/v1/status", {
        headers: headers(agent.token)
      })
    ).body
  );
  assert.equal(status.networkPhaseBenchmarkRunning, true);

  const codex = await send(agent.origin, "/v1/benchmarks/codex", {
    method: "POST",
    headers: headers(agent.token)
  });
  assert.equal(codex.status, 409);

  resolvePhase(phaseResult("https://chatgpt.com/"));
  assert.equal((await active).status, 200);
});

test("cancels the active catalog network phase run", async (context) => {
  const agent = await startAgentServer(
    { port: 0, token: "e".repeat(32) },
    {
      listServices: () => [service],
      runNetworkPhaseBenchmark: (options) =>
        new Promise((resolve) => {
          options.signal?.addEventListener(
            "abort",
            () => resolve(phaseResult(options.url, "cancelled")),
            { once: true }
          );
        })
    }
  );
  context.after(() => agent.close());

  const running = send(
    agent.origin,
    "/v1/benchmarks/network-phases/openai",
    { method: "POST", headers: headers(agent.token) }
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  const cancellation = await send(
    agent.origin,
    "/v1/benchmarks/network-phases",
    { method: "DELETE", headers: headers(agent.token) }
  );
  assert.equal(cancellation.status, 202);

  const result = JSON.parse((await running).body);
  assert.equal(result.cancelled, true);
  assert.equal(result.endpoints[0].result.status, "cancelled");
});

test("requires authentication for network phase routes", async (context) => {
  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());

  const response = await send(
    agent.origin,
    "/v1/benchmarks/network-phases/openai",
    { method: "POST" }
  );
  assert.equal(response.status, 401);
});
