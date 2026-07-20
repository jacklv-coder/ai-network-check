import assert from "node:assert/strict";
import test from "node:test";

import { renderAgentPanel } from "../src/agent-view.ts";

const status = {
  ok: true as const,
  name: "ai-network-check-agent" as const,
  version: 1 as const,
  authenticated: true as const,
  host: "127.0.0.1" as const,
  port: 3210,
  codexBenchmarkRunning: false,
  networkPhaseBenchmarkRunning: false,
  capabilities: {
    networkPhases: true,
    publicWebSocket: false,
    codexCli: true,
    claudeCodeCli: false
  }
};

const services = [{ id: "openai", label: "OpenAI" }];

test("renders connection instructions without persisting a token", () => {
  const html = renderAgentPanel({ phase: "disconnected" }, services);
  assert.match(html, /npm run start:agent/);
  assert.match(html, /只保存在当前页面内存/);
  assert.match(html, /type="password"/);
});

test("renders both local professional tools when connected", () => {
  const html = renderAgentPanel({ phase: "connected", status }, services);
  assert.match(html, /本地专业检测已准备好/);
  assert.match(html, /运行真实 Codex 检测/);
  assert.match(html, /DNS \/ TCP \/ TLS \/ TTFB/);
  assert.match(html, /OpenAI/);
});

test("renders successful real Codex metrics", () => {
  const html = renderAgentPanel(
    {
      phase: "result",
      status,
      benchmark: {
        promptId: "reply-exactly-ok-v1",
        result: {
          status: "success",
          inspection: {
            installed: true,
            authenticated: true,
            version: "codex 1.2"
          },
          durationMs: 1200,
          firstEventMs: 200,
          firstAgentMessageMs: 700,
          exitCode: 0,
          responseMatched: true,
          sawTurnCompleted: true,
          eventCounts: {}
        }
      }
    },
    services
  );
  assert.match(html, /真实 Codex 请求成功/);
  assert.match(html, /700 ms/);
  assert.match(html, /codex 1.2/);
});

test("renders DNS TCP TLS and TTFB for catalog endpoints", () => {
  const html = renderAgentPanel(
    {
      phase: "network-result",
      status,
      benchmark: {
        source: "service-catalog",
        serviceId: "openai",
        displayName: "OpenAI",
        cancelled: false,
        endpoints: [
          {
            endpointId: "openai-api",
            label: "OpenAI API",
            role: "api",
            critical: true,
            result: {
              url: "https://api.openai.com/",
              hostname: "api.openai.com",
              status: "success",
              resolvedAddress: "203.0.113.10",
              addressFamily: 4,
              httpStatus: 401,
              phases: {
                dnsMs: 10,
                tcpMs: 20,
                tlsMs: 30,
                requestToFirstByteMs: 40,
                totalToFirstByteMs: 100
              },
              errorCode: null
            }
          }
        ]
      }
    },
    services
  );
  assert.match(html, /OpenAI API/);
  assert.match(html, /10 ms/);
  assert.match(html, /30 ms/);
  assert.match(html, /100 ms/);
  assert.match(html, /HTTP 401/);
});

test("escapes Agent and endpoint errors", () => {
  const errorHtml = renderAgentPanel({ phase: "error", message: "<script>" });
  assert.doesNotMatch(errorHtml, /<script>/);
  assert.match(errorHtml, /&lt;script&gt;/);

  const resultHtml = renderAgentPanel({
    phase: "network-result",
    status,
    benchmark: {
      source: "service-catalog",
      serviceId: "openai",
      displayName: "<img>",
      cancelled: false,
      endpoints: []
    }
  });
  assert.doesNotMatch(resultHtml, /<img>/);
  assert.match(resultHtml, /&lt;img&gt;/);
});
