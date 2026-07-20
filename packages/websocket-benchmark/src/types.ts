import type { BenchmarkMetrics, BenchmarkSample } from "../../core/src/index.ts";

export type WebSocketBenchmarkStatus =
  | "completed"
  | "handshake-timeout"
  | "connection-error"
  | "closed-early";

export interface WebSocketMessageLike {
  readonly data: unknown;
}

export interface WebSocketCloseLike {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: WebSocketCloseLike) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketBenchmarkOptions {
  readonly url: string;
  readonly handshakeTimeoutMs?: number;
  readonly durationMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: WebSocketBenchmarkProgress) => void;
}

export interface WebSocketBenchmarkDependencies {
  readonly createWebSocket: (url: string) => WebSocketLike;
  readonly now: () => number;
  readonly sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  readonly createSessionId: () => string;
}

export interface WebSocketBenchmarkProgress {
  readonly type: "connecting" | "connected" | "heartbeat" | "completed";
  readonly url: string;
  readonly handshakeMs: number | null;
  readonly sentCount: number;
  readonly receivedCount: number;
  readonly lostCount: number;
  readonly latestSample: BenchmarkSample | null;
  readonly metrics: BenchmarkMetrics;
}

export interface WebSocketCloseInfo {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface WebSocketBenchmarkResult {
  readonly url: string;
  readonly status: WebSocketBenchmarkStatus;
  readonly handshakeMs: number | null;
  readonly connectionDurationMs: number;
  readonly targetDurationMs: number;
  readonly sentCount: number;
  readonly receivedCount: number;
  readonly lostCount: number;
  readonly samples: readonly BenchmarkSample[];
  readonly metrics: BenchmarkMetrics;
  readonly close: WebSocketCloseInfo | null;
}
