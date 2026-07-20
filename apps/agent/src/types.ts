import type { Server } from "node:http";
import type {
  CodexBenchmarkOptions,
  CodexBenchmarkResult
} from "../../../packages/cli-benchmark/src/index.ts";

export type LoopbackHost = "127.0.0.1" | "::1";

export interface AgentServerOptions {
  readonly host?: LoopbackHost;
  readonly port?: number;
  readonly token?: string;
  readonly allowedOrigins?: readonly string[];
}

export interface AgentServerDependencies {
  readonly runCodexBenchmark: (
    options: CodexBenchmarkOptions
  ) => Promise<CodexBenchmarkResult>;
}

export interface AgentCapabilityStatus {
  readonly networkPhases: false;
  readonly publicWebSocket: false;
  readonly codexCli: true;
  readonly claudeCodeCli: false;
}

export interface AgentHealthResponse {
  readonly ok: true;
  readonly name: "ai-network-check-agent";
  readonly version: 1;
}

export interface AgentStatusResponse extends AgentHealthResponse {
  readonly authenticated: true;
  readonly host: LoopbackHost;
  readonly port: number;
  readonly codexBenchmarkRunning: boolean;
  readonly capabilities: AgentCapabilityStatus;
}

export interface CodexBenchmarkApiResponse {
  readonly promptId: string;
  readonly result: CodexBenchmarkResult;
}

export interface RunningAgentServer {
  readonly server: Server;
  readonly host: LoopbackHost;
  readonly port: number;
  readonly origin: string;
  readonly token: string;
  readonly close: () => Promise<void>;
}
