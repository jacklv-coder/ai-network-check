import type { Server } from "node:http";

export type LoopbackHost = "127.0.0.1" | "::1";

export interface AgentServerOptions {
  readonly host?: LoopbackHost;
  readonly port?: number;
  readonly token?: string;
  readonly allowedOrigins?: readonly string[];
}

export interface AgentCapabilityStatus {
  readonly networkPhases: false;
  readonly publicWebSocket: false;
  readonly codexCli: false;
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
  readonly capabilities: AgentCapabilityStatus;
}

export interface RunningAgentServer {
  readonly server: Server;
  readonly host: LoopbackHost;
  readonly port: number;
  readonly origin: string;
  readonly token: string;
  readonly close: () => Promise<void>;
}
