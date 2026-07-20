import type {
  BenchmarkMetrics,
  BenchmarkSample,
  LatencyMetrics
} from "./types.ts";

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}

function assertValues(values: readonly number[]): void {
  values.forEach((value, index) => {
    assertFiniteNonNegative(value, `values[${index}]`);
  });
}

export function average(values: readonly number[]): number | null {
  assertValues(values);

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Calculates a percentile with linear interpolation between closest ranks.
 * `quantile` must be between 0 and 1, inclusive.
 */
export function percentile(
  values: readonly number[],
  quantile: number
): number | null {
  assertValues(values);

  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError("quantile must be between 0 and 1");
  }

  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new Error("percentile rank resolved outside the sample range");
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (rank - lowerIndex);
}

export function populationStandardDeviation(
  values: readonly number[]
): number | null {
  const mean = average(values);

  if (mean === null) {
    return null;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
}

export function meanAbsoluteSuccessiveDifference(
  values: readonly number[]
): number | null {
  assertValues(values);

  if (values.length === 0) {
    return null;
  }

  if (values.length === 1) {
    return 0;
  }

  let totalDifference = 0;

  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];

    if (current === undefined || previous === undefined) {
      throw new Error("sample index resolved outside the input range");
    }

    totalDifference += Math.abs(current - previous);
  }

  return totalDifference / (values.length - 1);
}

export function summarizeLatency(
  durationsMs: readonly number[]
): LatencyMetrics | null {
  assertValues(durationsMs);

  if (durationsMs.length === 0) {
    return null;
  }

  const averageMs = average(durationsMs);
  const p50Ms = percentile(durationsMs, 0.5);
  const p95Ms = percentile(durationsMs, 0.95);
  const p99Ms = percentile(durationsMs, 0.99);
  const standardDeviationMs = populationStandardDeviation(durationsMs);
  const jitterMs = meanAbsoluteSuccessiveDifference(durationsMs);

  if (
    averageMs === null ||
    p50Ms === null ||
    p95Ms === null ||
    p99Ms === null ||
    standardDeviationMs === null ||
    jitterMs === null
  ) {
    throw new Error("non-empty latency samples produced an empty metric");
  }

  return {
    sampleCount: durationsMs.length,
    minMs: Math.min(...durationsMs),
    maxMs: Math.max(...durationsMs),
    averageMs,
    p50Ms,
    p95Ms,
    p99Ms,
    standardDeviationMs,
    jitterMs
  };
}

export function summarizeBenchmarkSamples(
  samples: readonly BenchmarkSample[]
): BenchmarkMetrics {
  const counts = {
    success: 0,
    timeout: 0,
    "network-error": 0,
    "protocol-error": 0,
    cancelled: 0
  };
  const successfulDurations: number[] = [];

  samples.forEach((sample, index) => {
    assertFiniteNonNegative(sample.durationMs, `samples[${index}].durationMs`);
    counts[sample.status] += 1;

    if (sample.status === "success") {
      successfulDurations.push(sample.durationMs);
    }
  });

  const failureCount =
    counts.timeout + counts["network-error"] + counts["protocol-error"];
  const completedCount = counts.success + failureCount;

  return {
    totalCount: samples.length,
    completedCount,
    successCount: counts.success,
    failureCount,
    cancelledCount: counts.cancelled,
    timeoutCount: counts.timeout,
    networkErrorCount: counts["network-error"],
    protocolErrorCount: counts["protocol-error"],
    successRate: completedCount === 0 ? null : counts.success / completedCount,
    latency: summarizeLatency(successfulDurations)
  };
}
