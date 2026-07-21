import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentApiError,
  createAgentRequest,
  runAgentCodexBenchmark,
  runAgentNetworkPhaseBenchmark
} from "../src/agent-client.ts";

const connection = { port: 3210, token: "x".repeat(32) };

test("creates a loopback Agent request without a body", () => {
  const request = createAgentRequest(
    connection,
    "/v1/benchmarks/codex",
    "POST"
  );
  assert.equal(
    request.url,
    "http://127.0.0.1:3210/v1/benchmarks/codex"
  );
  assert.equal(request.method, "POST");
  assert.equal(
    request.headers.get("authorization"),
    `Bearer ${connection.token}`
  );
  assert.equal(request.body, null);
  assert.equal(request.credentials, "omit");
});

test("rejects invalid ports and tokens", () => {
  assert.throws(
    () =>
      createAgentRequest(
        { ...connection, port: 0 },
        "/v1/status",
        "GET"
      ),
    /between 1 and 65535/
  );
  assert.throws(
    () =>
      createAgentRequest(
        { ...connection, token: "short" },
        "/v1/status",
        "GET"
      ),
    /token is invalid/
  );
});

test("parses the fixed Codex response", async () => {
  const result = await runAgentCodexBenchmark(
    connection,
    undefined,
    async () =>
      new Response(
        JSON.stringify({
          promptId: "reply-exactly-ok-v1",
          result: {
            status: "success",
            inspection: {
              installed: true,
              authenticated: true,
              version: "codex 1"
            },
            durationMs: 1000,
            firstEventMs: 100,
            firstAgentMessageMs: 500,
            exitCode: 0,
            responseMatched: true,
            sawTurnCompleted: true,
            eventCounts: {}
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
  );
  assert.equal(result.result.status, "success");
  assert.equal(result.promptId, "reply-exactly-ok-v1");
});

test("submits only a validated service ID for network phase checks", async () => {
  let captured: Request | null = null;
  const result = await runAgentNetworkPhaseBenchmark(
    connection,
    "openai",
    undefined,
    async (request) => {
      captured = request;
      return new Response(
        JSON.stringify({
          source: "service-catalog",
          serviceId: "openai",
          displayName: "OpenAI",
          cancelled: false,
          endpoints: []
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  );

  assert.equal(
    captured?.url,
    "http://127.0.0.1:3210/v1/benchmarks/network-phases/openai"
  );
  assert.equal(captured?.body, null);
  assert.equal(result.source, "service-catalog");
});

test("rejects unsafe network phase service IDs before fetching", () => {
  assert.throws(
    () =>
      runAgentNetworkPhaseBenchmark(
        connection,
        "../https://evil.example",
        undefined,
        async () => new Response("{}")
      ),
    /service ID is invalid/
  );
});

test("normalizes unreachable Agent errors", async () => {
  await assert.rejects(
    () =>
      runAgentCodexBenchmark(connection, undefined, async () => {
        throw new TypeError("failed to fetch");
      }),
    (error) =>
      error instanceof AgentApiError && error.code === "agent-unreachable"
  );
});
