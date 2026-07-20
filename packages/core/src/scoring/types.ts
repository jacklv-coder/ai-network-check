import type { BenchmarkMetrics } from "../metrics/types.ts";

export type ScoreConfidence =
  | "browser-basic"
  | "browser-realtime"
  | "local-network"
  | "local-real-tool";

export type ScoreGrade = "excellent" | "good" | "fair" | "poor" | "critical";

export type ScoreDimensionId =
  | "success-rate"
  | "p95-latency"
  | "average-latency"
  | "jitter"
  | "critical-endpoint-coverage";

export type UnverifiedDimensionId = "realtime" | "real-tool";

export type ScoreCapId =
  | "request-failure"
  | "success-below-95"
  | "success-below-85"
  | "primary-unreachable";

export interface ScoreDimension {
  readonly id: ScoreDimensionId;
  readonly score: number;
  readonly maxScore: number;
  readonly measuredValue: number | null;
  readonly unit: "ratio" | "ms";
}

export interface ScoreCap {
  readonly id: ScoreCapId;
  readonly maximumScore: number;
}

export interface HttpsNetworkScoreInput {
  readonly metrics: BenchmarkMetrics;
  readonly criticalEndpointCoverage: number;
  readonly primaryEndpointReachable: boolean;
}

export interface HttpsNetworkScore {
  readonly kind: "ai-https-network";
  readonly confidence: "browser-basic";
  readonly score: number;
  readonly rawScore: number;
  readonly grade: ScoreGrade;
  readonly dimensions: readonly ScoreDimension[];
  readonly capsApplied: readonly ScoreCap[];
  readonly unverifiedDimensions: readonly UnverifiedDimensionId[];
}
