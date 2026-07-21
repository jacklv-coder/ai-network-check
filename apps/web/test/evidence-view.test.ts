import assert from "node:assert/strict";
import test from "node:test";

import { createEvidenceReport } from "@ai-network-check/evidence-report";
import {
  evidenceFilename,
  renderEvidencePanel
} from "../src/evidence-view.ts";

function snapshot(hasEvidence: boolean) {
  return {
    report: createEvidenceReport({
      createdAt: "2026-07-20T12:00:00.000Z",
      route: "LA <01>",
      limitations: [
        "ai-internal-websocket-unverified",
        "real-tool-not-run"
      ]
    }),
    coverage: {
      webHttps: hasEvidence,
      publicWebSocket: false,
      localNetworkServiceCount: 1,
      expectedLocalNetworkServiceCount: 5,
      realCodex: false
    },
    hasEvidence
  };
}

test("renders all evidence categories and verification limitations", () => {
  const html = renderEvidencePanel(snapshot(true));
  assert.match(html, /浏览器 HTTPS/);
  assert.match(html, /公共 WebSocket/);
  assert.match(html, /本地网络阶段/);
  assert.match(html, /真实 Codex/);
  assert.match(html, /AI 服务内部 WebSocket 仍未验证/);
});

test("disables evidence actions before any evidence exists", () => {
  const html = renderEvidencePanel(snapshot(false));
  assert.match(html, /download-evidence-button[^>]*disabled/);
  assert.match(html, /reset-evidence-button[^>]*disabled/);
});

test("escapes route names", () => {
  const html = renderEvidencePanel(snapshot(true));
  assert.doesNotMatch(html, /LA <01>/);
  assert.match(html, /LA &lt;01&gt;/);
});

test("builds a safe route-aware filename", () => {
  const filename = evidenceFilename(snapshot(true).report);
  assert.match(filename, /^ai-network-evidence-LA-01-/);
  assert.doesNotMatch(filename, /[<>:]/);
});
