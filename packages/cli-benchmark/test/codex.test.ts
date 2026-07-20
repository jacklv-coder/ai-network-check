import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectCodexCli,
  runBoundedCommand,
  runCodexCliBenchmark,
  type CodexBenchmarkDependencies,
  type CommandExecutionRequest,
  type CommandExecutionResult
} from "../src/index.ts";

function command(
  stdout = "",
  exitCode: number | null = 0,
  status: CommandExecutionResult["status"] = "completed"
): CommandExecutionResult {
  return { status, exitCode, stdout, stderr: "", durationMs: 10 };
}

function dependencies(
  handler: (request: CommandExecutionRequest) => Promise<CommandExecutionResult>
): Partial<CodexBenchmarkDependencies> & {
  removed: string[];
  requests: CommandExecutionRequest[];
} {
  const removed: string[] = [];
  const requests: CommandExecutionRequest[] = [];
  return {
    removed,
    requests,
    now: (() => {
      let value = 0;
      return () => (value += 10);
    })(),
    createTempDirectory: async () => "/tmp/codex-test",
    removeTempDirectory: async (path) => {
      removed.push(path);
    },
    runCommand: async (request) => {
      requests.push(request);
      return handler(request);
    }
  };
}

test("reports Codex as not installed", async () => {
  const deps = dependencies(async () => command("", null, "not-found"));
  assert.deepEqual(await inspectCodexCli("codex", 100, deps), {
    installed: false,
    authenticated: false,
    version: null
  });
});

test("reports installed but unauthenticated Codex", async () => {
  const deps = dependencies(async (request) =>
    request.args[0] === "--version"
      ? command("codex 1.2.3\n")
      : command("", 1)
  );
  const inspection = await inspectCodexCli("codex", 100, deps);
  assert.equal(inspection.installed, true);
  assert.equal(inspection.authenticated, false);
  assert.equal(inspection.version, "codex 1.2.3");
});

test("parses a successful JSONL benchmark without returning message text", async () => {
  const deps = dependencies(async (request) => {
    if (request.args[0] === "--version") return command("codex 1.2.3");
    if (request.args[0] === "login") return command("Logged in");
    request.onStdoutLine?.('{"type":"thread.started"}', 100);
    request.onStdoutLine?.(
      '{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}',
      250
    );
    request.onStdoutLine?.('{"type":"turn.completed"}', 300);
    return command("", 0);
  });

  const result = await runCodexCliBenchmark({}, deps);
  assert.equal(result.status, "success");
  assert.equal(result.firstEventMs, 100);
  assert.equal(result.firstAgentMessageMs, 250);
  assert.equal(result.responseMatched, true);
  assert.equal(result.sawTurnCompleted, true);
  assert.equal("stdout" in result, false);
  assert.deepEqual(deps.removed, ["/tmp/codex-test"]);
});

test("uses only the fixed safe Codex arguments", async () => {
  const deps = dependencies(async (request) => {
    if (request.args[0] === "--version") return command("codex 1");
    if (request.args[0] === "login") return command("ok");
    request.onStdoutLine?.(
      '{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}',
      10
    );
    request.onStdoutLine?.('{"type":"turn.completed"}', 20);
    return command();
  });
  await runCodexCliBenchmark({}, deps);
  const execRequest = deps.requests.find((request) => request.args[0] === "exec");
  assert.ok(execRequest);
  assert.deepEqual(execRequest.args.slice(0, 6), [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules"
  ]);
  assert.match(execRequest.args.at(-1) ?? "", /Reply with exactly OK/);
});

test("maps command timeout and still removes the temp directory", async () => {
  const deps = dependencies(async (request) => {
    if (request.args[0] === "--version") return command("codex 1");
    if (request.args[0] === "login") return command("ok");
    return command("", null, "timeout");
  });
  const result = await runCodexCliBenchmark({}, deps);
  assert.equal(result.status, "timeout");
  assert.deepEqual(deps.removed, ["/tmp/codex-test"]);
});

test("fails when the final response does not exactly match OK", async () => {
  const deps = dependencies(async (request) => {
    if (request.args[0] === "--version") return command("codex 1");
    if (request.args[0] === "login") return command("ok");
    request.onStdoutLine?.(
      '{"type":"item.completed","item":{"type":"agent_message","text":"Almost OK"}}',
      10
    );
    request.onStdoutLine?.('{"type":"turn.completed"}', 20);
    return command();
  });
  assert.equal((await runCodexCliBenchmark({}, deps)).status, "failed");
});

test("bounded command captures lines from a real child process", async () => {
  const lines: string[] = [];
  const result = await runBoundedCommand({
    command: process.execPath,
    args: ["-e", "console.log('one'); console.log('two')"],
    timeoutMs: 2_000,
    onStdoutLine: (line) => lines.push(line)
  });
  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(lines, ["one", "two"]);
});

test("bounded command enforces timeout", async () => {
  const result = await runBoundedCommand({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    timeoutMs: 20
  });
  assert.equal(result.status, "timeout");
});
