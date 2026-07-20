import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { startAgentServer } from "../src/index.ts";
import type {
  CodexBenchmarkOptions,
  CodexBenchmarkResult
} from "../../../packages/cli-benchmark/src/index.ts";

interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
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
      {
        method: options.method ?? "GET",
        headers: options.headers
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body
          })
        );
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function successResult(
  status: CodexBenchmarkResult["status"] = "success"
): CodexBenchmarkResult {
  return {
    status,
    inspection: {
      installed: true,
      authenticated: true,
      version: "codex 1.0"
    },
    durationMs: 1200,
    firstEventMs: 300,
    firstAgentMessageMs: 800,
    exitCode: status === "success" ? 0 : null,
    responseMatched: status === "success",
    sawTurnCompleted: status === "success",
    eventCounts: { "thread.started": 1, "turn.completed": 1 }
  };
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

test("serves an unauthenticated health endpoint on loopback", async (context) => {
  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());

  assert.equal(agent.host, "127.0.0.1");
  const response = await send(agent.origin, "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    name: "ai-network-check-agent",
    version: 1
  });
});

test("requires a bearer token and exposes enabled Codex API capability", async (context) => {
  const agent = await startAgentServer({ port: 0, token: "x".repeat(32) });
  context.after(() => agent.close());

  assert.equal((await send(agent.origin, "/v1/status")).status, 401);
  const response = await send(agent.origin, "/v1/status", {
    headers: authHeaders(agent.token)
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.authenticated, true);
  assert.equal(body.capabilities.codexCli, true);
  assert.equal(body.codexBenchmarkRunning, false);
});

test("rejects DNS rebinding host headers", async (context) => {
  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());

  const response = await send(agent.origin, "/health", {
    headers: { host: `evil.example:${agent.port}` }
  });
  assert.equal(response.status, 421);
});

test("allows only configured browser origins", async (context) => {
  const agent = await startAgentServer({
    port: 0,
    token: "z".repeat(32),
    allowedOrigins: ["https://jacklv-coder.github.io"]
  });
  context.after(() => agent.close());

  const denied = await send(agent.origin, "/v1/status", {
    headers: {
      origin: "https://evil.example",
      ...authHeaders(agent.token)
    }
  });
  assert.equal(denied.status, 403);

  const allowed = await send(agent.origin, "/v1/status", {
    headers: {
      origin: "https://jacklv-coder.github.io",
      ...authHeaders(agent.token)
    }
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "https://jacklv-coder.github.io"
  );
});

test("runs the fixed Codex benchmark without accepting parameters", async (context) => {
  let receivedOptions: CodexBenchmarkOptions | null = null;
  const agent = await startAgentServer(
    { port: 0, token: "a".repeat(32) },
    {
      runCodexBenchmark: async (options) => {
        receivedOptions = options;
        return successResult();
      }
    }
  );
  context.after(() => agent.close());

  const response = await send(agent.origin, "/v1/benchmarks/codex", {
    method: "POST",
    headers: authHeaders(agent.token)
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.promptId, "reply-exactly-ok-v1");
  assert.equal(body.result.status, "success");
  assert.ok(receivedOptions?.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(receivedOptions ?? {}), ["signal"]);
  assert.equal("stdout" in body.result, false);
});

test("rejects request bodies for the Codex benchmark", async (context) => {
  const agent = await startAgentServer(
    { port: 0, token: "b".repeat(32) },
    { runCodexBenchmark: async () => successResult() }
  );
  context.after(() => agent.close());

  const response = await send(agent.origin, "/v1/benchmarks/codex", {
    method: "POST",
    headers: {
      ...authHeaders(agent.token),
      "content-type": "application/json"
    },
    body: JSON.stringify({ prompt: "arbitrary" })
  });
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(response.body).error, "request-body-not-allowed");
});

test("allows only one Codex benchmark at a time and reports running state", async (context) => {
  let resolveRun!: (result: CodexBenchmarkResult) => void;
  const pending = new Promise<CodexBenchmarkResult>((resolve) => {
    resolveRun = resolve;
  });
  const agent = await startAgentServer(
    { port: 0, token: "c".repeat(32) },
    { runCodexBenchmark: async () => pending }
  );
  context.after(() => agent.close());

  const first = send(agent.origin, "/v1/benchmarks/codex", {
    method: "POST",
    headers: authHeaders(agent.token)
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const status = await send(agent.origin, "/v1/status", {
    headers: authHeaders(agent.token)
  });
  assert.equal(JSON.parse(status.body).codexBenchmarkRunning, true);

  const second = await send(agent.origin, "/v1/benchmarks/codex", {
    method: "POST",
    headers: authHeaders(agent.token)
  });
  assert.equal(second.status, 409);

  resolveRun(successResult());
  assert.equal((await first).status, 200);
});

test("cancels the active Codex benchmark through DELETE", async (context) => {
  const agent = await startAgentServer(
    { port: 0, token: "d".repeat(32) },
    {
      runCodexBenchmark: (options) =>
        new Promise((resolve) => {
          options.signal?.addEventListener(
            "abort",
            () => resolve(successResult("cancelled")),
            { once: true }
          );
        })
    }
  );
  context.after(() => agent.close());

  const running = send(agent.origin, "/v1/benchmarks/codex", {
    method: "POST",
    headers: authHeaders(agent.token)
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const cancellation = await send(agent.origin, "/v1/benchmarks/codex", {
    method: "DELETE",
    headers: authHeaders(agent.token)
  });
  assert.equal(cancellation.status, 202);
  const result = JSON.parse((await running).body);
  assert.equal(result.result.status, "cancelled");
});

test("rejects short tokens, invalid ports, and unknown routes", async (context) => {
  await assert.rejects(() => startAgentServer({ token: "short" }), /at least 32/);
  await assert.rejects(
    () => startAgentServer({ port: -1 }),
    /between 0 and 65535/
  );

  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());
  assert.equal((await send(agent.origin, "/unknown")).status, 404);
});
