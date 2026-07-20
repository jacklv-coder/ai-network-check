import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { startAgentServer } from "../src/index.ts";

function get(
  origin: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers }, (response) => {
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
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves an unauthenticated health endpoint on loopback", async (context) => {
  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());

  assert.equal(agent.host, "127.0.0.1");
  const response = await get(agent.origin, "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    name: "ai-network-check-agent",
    version: 1
  });
});

test("requires a bearer token for status", async (context) => {
  const agent = await startAgentServer({ port: 0, token: "x".repeat(32) });
  context.after(() => agent.close());

  assert.equal((await get(agent.origin, "/v1/status")).status, 401);
  const response = await get(agent.origin, "/v1/status", {
    authorization: `Bearer ${agent.token}`
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.authenticated, true);
  assert.equal(body.capabilities.codexCli, false);
});

test("rejects DNS rebinding host headers", async (context) => {
  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());

  const response = await get(agent.origin, "/health", {
    host: `evil.example:${agent.port}`
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

  const denied = await get(agent.origin, "/v1/status", {
    origin: "https://evil.example",
    authorization: `Bearer ${agent.token}`
  });
  assert.equal(denied.status, 403);

  const allowed = await get(agent.origin, "/v1/status", {
    origin: "https://jacklv-coder.github.io",
    authorization: `Bearer ${agent.token}`
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "https://jacklv-coder.github.io"
  );
});

test("rejects short tokens and invalid ports", async () => {
  await assert.rejects(() => startAgentServer({ token: "short" }), /at least 32/);
  await assert.rejects(() => startAgentServer({ port: -1 }), /between 0 and 65535/);
});

test("returns 404 for unknown routes", async (context) => {
  const agent = await startAgentServer({ port: 0 });
  context.after(() => agent.close());
  assert.equal((await get(agent.origin, "/unknown")).status, 404);
});
