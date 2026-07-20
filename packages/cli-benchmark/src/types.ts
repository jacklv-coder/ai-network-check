export type CommandExecutionStatus =
  | "completed"
  | "not-found"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "spawn-error";

export interface CommandExecutionRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly onStdoutLine?: (line: string, elapsedMs: number) => void;
}

export interface CommandExecutionResult {
  readonly status: CommandExecutionStatus;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface CodexCliInspection {
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly version: string | null;
}

export type CodexBenchmarkStatus =
  | "success"
  | "not-installed"
  | "not-authenticated"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "failed";

export interface CodexBenchmarkProgress {
  readonly type: "inspection" | "running" | "event" | "completed";
  readonly eventType?: string;
  readonly elapsedMs: number;
}

export interface CodexBenchmarkOptions {
  readonly binaryPath?: string;
  readonly inspectionTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CodexBenchmarkProgress) => void;
}

export interface CodexBenchmarkResult {
  readonly status: CodexBenchmarkStatus;
  readonly inspection: CodexCliInspection;
  readonly durationMs: number;
  readonly firstEventMs: number | null;
  readonly firstAgentMessageMs: number | null;
  readonly exitCode: number | null;
  readonly responseMatched: boolean;
  readonly sawTurnCompleted: boolean;
  readonly eventCounts: Readonly<Record<string, number>>;
}

export interface CodexBenchmarkDependencies {
  readonly runCommand: (
    request: CommandExecutionRequest
  ) => Promise<CommandExecutionResult>;
  readonly createTempDirectory: () => Promise<string>;
  readonly removeTempDirectory: (path: string) => Promise<void>;
  readonly now: () => number;
}
