export const BENCHMARK_SAMPLE_STATUSES = [
  "success",
  "timeout",
  "network-error",
  "protocol-error",
  "cancelled"
] as const;

export type BenchmarkSampleStatus = (typeof BENCHMARK_SAMPLE_STATUSES)[number];

export interface BenchmarkSample {
  readonly status: BenchmarkSampleStatus;
  readonly durationMs: number;
}

export interface LatencyMetrics {
  readonly sampleCount: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly averageMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly standardDeviationMs: number;
  /**
   * Mean absolute difference between consecutive successful samples.
   * A single successful sample has zero jitter.
   */
  readonly jitterMs: number;
}

export interface BenchmarkMetrics {
  readonly totalCount: number;
  readonly completedCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly cancelledCount: number;
  readonly timeoutCount: number;
  readonly networkErrorCount: number;
  readonly protocolErrorCount: number;
  /** Successes divided by completed samples. Null when nothing completed. */
  readonly successRate: number | null;
  readonly latency: LatencyMetrics | null;
}
