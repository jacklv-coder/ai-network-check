import type {
  BenchmarkMetrics,
  BenchmarkSample
} from "../metrics/types.ts";
import type {
  HttpsNetworkScore,
  ScoreConfidence
} from "../scoring/types.ts";

export const BENCHMARK_REPORT_SCHEMA_VERSION = 1 as const;

export type BenchmarkReportSchemaVersion =
  typeof BENCHMARK_REPORT_SCHEMA_VERSION;

export type BenchmarkMode = "web" | "local";

export type ReportLimitation =
  | "http-status-unverified"
  | "network-phases-unverified"
  | "websocket-unverified"
  | "real-tool-unverified";

export type HttpStatusVerification = "verified" | "unverified";

export interface EndpointBenchmarkReport {
  readonly endpointId: string;
  readonly httpStatusVerification: HttpStatusVerification;
  readonly samples: readonly BenchmarkSample[];
  readonly metrics: BenchmarkMetrics;
}

export interface ServiceBenchmarkReport {
  readonly serviceId: string;
  readonly primaryEndpointReachable: boolean;
  readonly criticalEndpointCoverage: number;
  readonly endpoints: readonly EndpointBenchmarkReport[];
  readonly score: HttpsNetworkScore | null;
}

export interface BenchmarkReport {
  readonly schemaVersion: BenchmarkReportSchemaVersion;
  readonly mode: BenchmarkMode;
  readonly confidence: ScoreConfidence;
  readonly route: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly services: readonly ServiceBenchmarkReport[];
  readonly limitations: readonly ReportLimitation[];
}

export interface CreateEndpointBenchmarkReportInput {
  readonly endpointId: string;
  readonly httpStatusVerification: HttpStatusVerification;
  readonly samples: readonly BenchmarkSample[];
}

export interface CreateBenchmarkReportInput {
  readonly mode: BenchmarkMode;
  readonly confidence: ScoreConfidence;
  readonly route?: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly services: readonly ServiceBenchmarkReport[];
  readonly limitations: readonly ReportLimitation[];
}
