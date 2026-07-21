import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_ALLOWED_ORIGINS,
  DEFAULT_AGENT_PORT,
  resolveAgentCliOptions
} from "../src/cli-options.ts";

test("uses the default Agent port and fixed browser origins", () => {
  assert.deepEqual(resolveAgentCliOptions({}), {
    port: DEFAULT_AGENT_PORT,
    allowedOrigins: DEFAULT_AGENT_ALLOWED_ORIGINS
  });
});

test("allows port zero for an ephemeral loopback listener", () => {
  assert.equal(
    resolveAgentCliOptions({ AI_NETWORK_CHECK_AGENT_PORT: "0" }).port,
    0
  );
});

test("rejects malformed or out-of-range Agent ports", () => {
  for (const value of ["abc", "-1", "65536", "3.14"]) {
    assert.throws(
      () => resolveAgentCliOptions({ AI_NETWORK_CHECK_AGENT_PORT: value }),
      /between 0 and 65535/
    );
  }
});
