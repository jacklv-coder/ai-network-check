import type { BenchmarkReport } from "../../core/src/index.ts";
import type { CodexBenchmarkResult } from "../../cli-benchmark/src/index.ts";
import type { NetworkPhaseBenchmarkResult } from "../../network-phase-benchmark/src/index.ts";
import type { WebSocketBenchmarkResult } from "../../websocket-benchmark/src/index.ts";

export const EVIDENCE_REPORT_SCHEMA_VERSION = 1 as const;
export const EVIDENCE_REPORT_KIND = "ai-network-check-evidence" as const;

export type EvidenceReportSchemaVersion =
  typeof EVIDENCE_REPORT_SCHEMA_VERSION;

export type EvidenceLimitation =
  | "browser-http-status-unverified"
  | "public-websocket-only"
  | "ai-internal-websocket-unverified"
  | "local-network-phases-partial"
  | "real-tool-not-run";

export interface PublicWebSocketEvidence {
  readonly kind: "public-websocket";
  readonly provider: "postman-echo";
  readonly verifiedScope: "public-echo-only";
  readonly collectedAt: string;
  readonly result: WebSocketBenchmarkResult;
}

export interface LocalNetworkEndpointEvidence {
  readonly endpointId: string;
  readonly label: string;
  readonly role: string;
  readonly critical: boolean;
  readonly result: NetworkPhaseBenchmarkResult;
}

export interface LocalNetworkServiceEvidence {
  readonly kind: "local-network-phases";
  readonly source: "service-catalog";
  readonly serviceId: string;
  readonly displayName: string;
  readonly collectedAt: string;
  readonly cancelled: boolean;
  readonly endpoints: readonly LocalNetworkEndpointEvidence[];
}

export interface RealToolEvidence {
  readonly kind: "real-tool";
  readonly tool: "codex";
  readonly promptId: string;
  readonly collectedAt: string;
  readonly result: CodexBenchmarkResult;
}

export interface EvidenceReport {
  readonly schemaVersion: EvidenceReportSchemaVersion;
  readonly kind: typeof EVIDENCE_REPORT_KIND;
  readonly createdAt: string;
  readonly route: string | null;
  readonly webReport: BenchmarkReport | null;
  readonly publicWebSocket: PublicWebSocketEvidence | null;
  readonly localNetwork: readonly LocalNetworkServiceEvidence[];
  readonly realTools: readonly RealToolEvidence[];
  readonly limitations: readonly EvidenceLimitation[];
}

export interface CreateEvidenceReportInput {
  readonly createdAt: string;
  readonly route?: string | null;
  readonly webReport?: BenchmarkReport | null;
  readonly publicWebSocket?: PublicWebSocketEvidence | null;
  readonly localNetwork?: readonly LocalNetworkServiceEvidence[];
  readonly realTools?: readonly RealToolEvidence[];
  readonly limitations?: readonly EvidenceLimitation[];
}
