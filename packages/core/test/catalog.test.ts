import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_SERVICE_CATALOG,
  getPrimaryEndpoint,
  getService,
  listServices,
  listServicesByProvider,
  validateServiceCatalog
} from "../src/index.ts";

test("catalog passes structural validation", () => {
  assert.deepEqual(validateServiceCatalog(), []);
});

test("catalog exposes the initial AI providers", () => {
  assert.deepEqual(
    listServices().map((service) => service.id),
    ["openai", "anthropic", "google-gemini", "alibaba-qwen", "deepseek"]
  );
});

test("service lookup returns the requested service", () => {
  const service = getService("openai");

  assert.ok(service);
  assert.equal(service.displayName, "OpenAI");
  assert.deepEqual(service.products, ["chatgpt", "openai-api", "codex"]);
});

test("provider filtering does not mix providers", () => {
  const services = listServicesByProvider("anthropic");

  assert.equal(services.length, 1);
  assert.equal(services[0]?.id, "anthropic");
});

test("every service has exactly one primary HTTPS endpoint", () => {
  for (const service of AI_SERVICE_CATALOG) {
    const primary = getPrimaryEndpoint(service);

    assert.equal(primary.role, "primary");
    assert.equal(new URL(primary.url).protocol, "https:");
  }
});

test("validator reports duplicate service and endpoint ids", () => {
  const duplicated = [AI_SERVICE_CATALOG[0], AI_SERVICE_CATALOG[0]];
  const errors = validateServiceCatalog(duplicated);

  assert.ok(errors.includes("Duplicate service id: openai"));
  assert.ok(errors.some((error) => error.startsWith("Duplicate endpoint id:")));
});
