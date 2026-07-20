import { spawn } from "node:child_process";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandExecutionStatus
} from "./types.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const TERMINATION_GRACE_MS = 250;

export function runBoundedCommand(
  request: CommandExecutionRequest,
  now: () => number = () => performance.now()
): Promise<CommandExecutionResult> {
  const startedAt = now();
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError("maxOutputBytes must be a positive integer");
  }

  return new Promise((resolve) => {
    let settled = false;
    let forcedStatus: CommandExecutionStatus | null = null;
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let child: { kill(signal?: NodeJS.Signals | number): boolean } | null = null;
    let timeout: NodeJS.Timeout | null = null;
    let killTimeout: NodeJS.Timeout | null = null;

    const finish = (status: CommandExecutionStatus, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      request.signal?.removeEventListener("abort", abortHandler);
      if (lineBuffer && request.onStdoutLine) {
        request.onStdoutLine(lineBuffer, Math.max(0, now() - startedAt));
      }
      resolve({
        status,
        exitCode,
        stdout,
        stderr,
        durationMs: Math.max(0, now() - startedAt)
      });
    };

    const terminate = (status: CommandExecutionStatus) => {
      if (settled || forcedStatus) return;
      forcedStatus = status;
      child?.kill("SIGTERM");
      killTimeout = setTimeout(
        () => child?.kill("SIGKILL"),
        TERMINATION_GRACE_MS
      );
      killTimeout.unref();
    };

    const abortHandler = () => terminate("cancelled");

    try {
      const spawned = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child = spawned;

      timeout = setTimeout(() => terminate("timeout"), request.timeoutMs);
      timeout.unref();

      if (request.signal?.aborted) {
        terminate("cancelled");
      } else {
        request.signal?.addEventListener("abort", abortHandler, { once: true });
      }

      spawned.stdout.setEncoding("utf8");
      spawned.stderr.setEncoding("utf8");

      spawned.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        lineBuffer += chunk;
        let newlineIndex = lineBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
          lineBuffer = lineBuffer.slice(newlineIndex + 1);
          request.onStdoutLine?.(line, Math.max(0, now() - startedAt));
          newlineIndex = lineBuffer.indexOf("\n");
        }
        if (
          Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >
          maxOutputBytes
        ) {
          terminate("output-limit");
        }
      });

      spawned.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (
          Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >
          maxOutputBytes
        ) {
          terminate("output-limit");
        }
      });

      spawned.once("error", (error: NodeJS.ErrnoException) => {
        finish(error.code === "ENOENT" ? "not-found" : "spawn-error", null);
      });

      spawned.once("close", (code) => {
        finish(forcedStatus ?? "completed", code);
      });
    } catch {
      finish("spawn-error", null);
    }
  });
}
