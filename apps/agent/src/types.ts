import type { Server } from "node:http";
import type {
  AIServiceDefinition,
  EndpointRole
} from "../../../packages/core/src/index.ts";
import type {
  CodexBenchmarkOptions,
  CodexBenchmarkResult
} from "../../../packages/cli-benchmark/src/index.ts";
import type {
  NetworkPhaseBenchmarkOptions,
  NetworkPhaseBenchmarkResult
} from "../../../packages/network-phase-benchmark/src/index.ts";

export type LoopbackHost = "127.0.0.1" | "::1";

export interface AgentServerOptions {
  readonly host?: LoopbackHost;
  readonly port?: number;
  readonly token?: string;
  readonly allowedOrigins?: readonly string[];
}

export interface AgentServerDependencies {
  readonly listServices: () => readonly AIServiceDefinition[];
  readonly runCodexBenchmark: (
    options: CodexBenchmarkOptions
  ) => Promise<CodexBenchmarkResult>;
  readonly runNetworkPhaseBenchmark: (
    options: NetworkPhaseBenchmarkOptions
  ) => Promise<NetworkPhaseBenchmarkResult>;
}

export interface AgentCapabilityStatus {
  readonly networkPhases: true;
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
  readonly networkPhaseBenchmarkRunning: boolean;
  readonly capabilities: AgentCapabilityStatus;
}

export interface CodexBenchmarkApiResponse {
  readonly promptId: string;
  readonly result: CodexBenchmarkResult;
}

export interface NetworkPhaseEndpointApiResult {
  readonly endpointId: string;
  readonly label: string;
  readonly role: EndpointRole;
  readonly critical: boolean;
  readonly result: NetworkPhaseBenchmarkResult;
}

export interface NetworkPhaseServiceApiResponse {
  readonly source: "service-catalog";
  readonly serviceId: string;
  readonly displayName: string;
  readonly cancelled: boolean;
  readonly endpoints: readonly NetworkPhaseEndpointApiResult[];
}

export interface RunningAgentServer {
  readonly server: Server;
  readonly host: LoopbackHost;
  readonly port: number;
  readonly origin: string;
  readonly token: string;
  readonly close: () => Promise<void>;
}
