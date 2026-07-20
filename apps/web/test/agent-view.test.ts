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
  capabilities: {
    networkPhases: false,
    publicWebSocket: false,
    codexCli: true,
    claudeCodeCli: false
  }
};

test("renders connection instructions without persisting a token", () => {
  const html = renderAgentPanel({ phase: "disconnected" });
  assert.match(html, /npm run start:agent/);
  assert.match(html, /只保存在当前页面内存/);
  assert.match(html, /type="password"/);
});

test("renders connected Agent state", () => {
  const html = renderAgentPanel({ phase: "connected", status });
  assert.match(html, /本地 Agent 已准备好/);
  assert.match(html, /运行真实 Codex 检测/);
});

test("renders successful real Codex metrics", () => {
  const html = renderAgentPanel({
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
  });
  assert.match(html, /真实 Codex 请求成功/);
  assert.match(html, /700 ms/);
  assert.match(html, /codex 1.2/);
});

test("escapes Agent errors", () => {
  const html = renderAgentPanel({ phase: "error", message: "<script>" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
