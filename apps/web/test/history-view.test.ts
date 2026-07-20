import assert from "node:assert/strict";
import test from "node:test";

import { renderRouteHistory } from "../src/history-view.ts";

const definitions = [
  {
    id: "openai",
    provider: "openai" as const,
    displayName: "OpenAI",
    products: ["chatgpt" as const],
    capabilities: ["browser-https" as const],
    limitations: ["opaque-response" as const],
    endpoints: []
  }
];

test("renders an empty history state", () => {
  assert.match(renderRouteHistory([], definitions), /还没有已命名路线/);
});

test("renders route and service scores", () => {
  const html = renderRouteHistory(
    [
      {
        route: "LA-01",
        reportCount: 2,
        latestCompletedAt: "2026-07-20T10:00:00Z",
        services: [
          {
            serviceId: "openai",
            reportCount: 2,
            averageScore: 91,
            latestScore: 94,
            latestGrade: "excellent"
          }
        ]
      }
    ],
    definitions
  );
  assert.match(html, /LA-01/);
  assert.match(html, /OpenAI/);
  assert.match(html, /均值 91/);
  assert.match(html, /优秀/);
});

test("escapes route and service values", () => {
  const html = renderRouteHistory(
    [
      {
        route: "<img>",
        reportCount: 1,
        latestCompletedAt: "bad",
        services: [
          {
            serviceId: "<script>",
            reportCount: 1,
            averageScore: null,
            latestScore: null,
            latestGrade: null
          }
        ]
      }
    ],
    []
  );
  assert.doesNotMatch(html, /<img>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img&gt;/);
});
