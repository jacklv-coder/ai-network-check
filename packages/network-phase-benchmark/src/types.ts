import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";

export type NetworkPhaseBenchmarkStatus =
  | "success"
  | "dns-error"
  | "tcp-error"
  | "tls-error"
  | "timeout"
  | "cancelled"
  | "request-error";

export interface NetworkPhaseDurations {
  readonly dnsMs: number;
  readonly tcpMs: number;
  readonly tlsMs: number;
  readonly requestToFirstByteMs: number;
  readonly totalToFirstByteMs: number;
}

export interface NetworkPhaseBenchmarkResult {
  readonly url: string;
  readonly hostname: string;
  readonly status: NetworkPhaseBenchmarkStatus;
  readonly resolvedAddress: string | null;
  readonly addressFamily: number | null;
  readonly httpStatus: number | null;
  readonly phases: NetworkPhaseDurations | null;
  readonly errorCode: string | null;
}

export interface NetworkPhaseBenchmarkOptions {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type HttpsRequestFactory = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void
) => ClientRequest;

export interface NetworkPhaseBenchmarkDependencies {
  readonly request: HttpsRequestFactory;
  readonly now: () => number;
}
