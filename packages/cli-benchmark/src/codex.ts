import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBoundedCommand } from "./process.ts";
import type {
  CodexBenchmarkDependencies,
  CodexBenchmarkOptions,
  CodexBenchmarkProgress,
  CodexBenchmarkResult,
  CodexCliInspection,
  CommandExecutionRequest,
  CommandExecutionResult
} from "./types.ts";

const FIXED_PROMPT =
  "Do not inspect files or run commands. Reply with exactly OK.";
const DEFAULT_INSPECTION_TIMEOUT_MS = 5_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

const DEFAULT_DEPENDENCIES: CodexBenchmarkDependencies = {
  runCommand: (request) => runBoundedCommand(request),
  createTempDirectory: () =>
    mkdtemp(join(tmpdir(), "ai-network-check-codex-")),
  removeTempDirectory: (path) => rm(path, { recursive: true, force: true }),
  now: () => performance.now()
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function mergeDependencies(
  overrides?: Partial<CodexBenchmarkDependencies>
): CodexBenchmarkDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function sanitizedVersion(output: string): string | null {
  const line = output.split(/\r?\n/, 1)[0]?.trim();
  if (!line) return null;
  return line.slice(0, 160);
}

export async function inspectCodexCli(
  binaryPath = "codex",
  timeoutMs = DEFAULT_INSPECTION_TIMEOUT_MS,
  dependencyOverrides?: Partial<CodexBenchmarkDependencies>
): Promise<CodexCliInspection> {
  const dependencies = mergeDependencies(dependencyOverrides);
  positiveInteger(timeoutMs, "inspectionTimeoutMs");

  const version = await dependencies.runCommand({
    command: binaryPath,
    args: ["--version"],
    timeoutMs
  });

  if (version.status === "not-found" || version.status === "spawn-error") {
    return { installed: false, authenticated: false, version: null };
  }

  const authentication = await dependencies.runCommand({
    command: binaryPath,
    args: ["login", "status"],
    timeoutMs
  });

  return {
    installed: true,
    authenticated:
      authentication.status === "completed" && authentication.exitCode === 0,
    version: sanitizedVersion(version.stdout || version.stderr)
  };
}

function mapCommandStatus(
  result: CommandExecutionResult
): CodexBenchmarkResult["status"] {
  if (result.status === "timeout") return "timeout";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "output-limit") return "output-limit";
  return "failed";
}

export async function runCodexCliBenchmark(
  options: CodexBenchmarkOptions = {},
  dependencyOverrides?: Partial<CodexBenchmarkDependencies>
): Promise<CodexBenchmarkResult> {
  const dependencies = mergeDependencies(dependencyOverrides);
  const binaryPath = options.binaryPath ?? "codex";
  const inspectionTimeoutMs = positiveInteger(
    options.inspectionTimeoutMs ?? DEFAULT_INSPECTION_TIMEOUT_MS,
    "inspectionTimeoutMs"
  );
  const runTimeoutMs = positiveInteger(
    options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    "runTimeoutMs"
  );
  const startedAt = dependencies.now();
  const progress = (event: Omit<CodexBenchmarkProgress, "elapsedMs">) =>
    options.onProgress?.({
      ...event,
      elapsedMs: Math.max(0, dependencies.now() - startedAt)
    });

  progress({ type: "inspection" });
  const inspection = await inspectCodexCli(
    binaryPath,
    inspectionTimeoutMs,
    dependencies
  );

  const base = {
    inspection,
    durationMs: Math.max(0, dependencies.now() - startedAt),
    firstEventMs: null,
    firstAgentMessageMs: null,
    exitCode: null,
    responseMatched: false,
    sawTurnCompleted: false,
    eventCounts: {}
  } as const;

  if (!inspection.installed) {
    return { ...base, status: "not-installed" };
  }
  if (!inspection.authenticated) {
    return { ...base, status: "not-authenticated" };
  }

  const temporaryDirectory = await dependencies.createTempDirectory();
  const eventCounts: Record<string, number> = {};
  let firstEventMs: number | null = null;
  let firstAgentMessageMs: number | null = null;
  let responseMatched = false;
  let sawTurnCompleted = false;
  let sawFailureEvent = false;

  progress({ type: "running" });

  try {
    const request: CommandExecutionRequest = {
      command: binaryPath,
      args: [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        FIXED_PROMPT
      ],
      cwd: temporaryDirectory,
      timeoutMs: runTimeoutMs,
      maxOutputBytes: 1_000_000,
      signal: options.signal,
      onStdoutLine: (line, elapsedMs) => {
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (!event || typeof event !== "object" || Array.isArray(event)) return;
        const record = event as Record<string, unknown>;
        const type = typeof record.type === "string" ? record.type : "unknown";
        eventCounts[type] = (eventCounts[type] ?? 0) + 1;
        firstEventMs ??= elapsedMs;
        progress({ type: "event", eventType: type });

        if (type === "turn.completed") sawTurnCompleted = true;
        if (type === "turn.failed" || type === "error") sawFailureEvent = true;

        if (type === "item.completed") {
          const item = record.item;
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const itemRecord = item as Record<string, unknown>;
            if (
              itemRecord.type === "agent_message" &&
              typeof itemRecord.text === "string"
            ) {
              firstAgentMessageMs ??= elapsedMs;
              responseMatched ||= itemRecord.text.trim() === "OK";
            }
          }
        }
      }
    };

    const command = await dependencies.runCommand(request);
    const successful =
      command.status === "completed" &&
      command.exitCode === 0 &&
      sawTurnCompleted &&
      responseMatched &&
      !sawFailureEvent;
    const status = successful ? "success" : mapCommandStatus(command);

    progress({ type: "completed" });
    return {
      status,
      inspection,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      firstEventMs,
      firstAgentMessageMs,
      exitCode: command.exitCode,
      responseMatched,
      sawTurnCompleted,
      eventCounts
    };
  } finally {
    await dependencies.removeTempDirectory(temporaryDirectory);
  }
}

export const CODEX_BENCHMARK_PROMPT_ID = "reply-exactly-ok-v1" as const;
