import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const executable = resolve(directory, "../dist/ai-network-check-agent.mjs");
const child = spawn(process.execPath, [executable], {
  env: {
    ...process.env,
    AI_NETWORK_CHECK_AGENT_PORT: "0"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
let settled = false;

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));

const timeout = setTimeout(() => {
  child.kill("SIGKILL");
}, 10_000);

timeout.unref();

try {
  const origin = await new Promise((resolveOrigin, reject) => {
    const inspect = () => {
      const match = stdout.match(/Listening: (http:\/\/[^\s]+)/);
      if (match?.[1]) {
        settled = true;
        resolveOrigin(match[1]);
      }
    };

    child.stdout.on("data", inspect);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!settled) {
        reject(
          new Error(
            `Agent exited before startup (code ${code}). stderr: ${stderr}`
          )
        );
      }
    });
    inspect();
  });

  assert.match(stdout, /Session token: [A-Za-z0-9_-]{32,}/);
  const response = await fetch(`${origin}/health`, { cache: "no-store" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    name: "ai-network-check-agent",
    version: 1
  });
} finally {
  clearTimeout(timeout);
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }
    child.once("exit", resolveExit);
  });
}

console.log("Bundled Local Agent smoke test passed");
