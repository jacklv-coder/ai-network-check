import type { BenchmarkReport, ScoreGrade } from "../../core/src/index.ts";

export const REPORT_HISTORY_SCHEMA_VERSION = 1 as const;
export const DEFAULT_REPORT_HISTORY_KEY = "ai-network-check:report-history:v1";
export const DEFAULT_REPORT_HISTORY_LIMIT = 20;

export interface ReportHistoryEnvelope {
  readonly schemaVersion: typeof REPORT_HISTORY_SCHEMA_VERSION;
  readonly reports: readonly BenchmarkReport[];
}

export interface ReportHistoryOptions {
  readonly key?: string;
  readonly limit?: number;
}

export interface BenchmarkReportExport {
  readonly filename: string;
  readonly mimeType: "application/json" | "text/plain";
  readonly content: string;
}

export interface RouteServiceAggregate {
  readonly serviceId: string;
  readonly reportCount: number;
  readonly averageScore: number | null;
  readonly latestScore: number | null;
  readonly latestGrade: ScoreGrade | null;
}

export interface RouteHistoryAggregate {
  readonly route: string;
  readonly reportCount: number;
  readonly latestCompletedAt: string;
  readonly services: readonly RouteServiceAggregate[];
}
