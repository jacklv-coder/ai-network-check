import type {
  HttpsNetworkScore,
  HttpsNetworkScoreInput,
  ScoreCap,
  ScoreDimension,
  ScoreGrade
} from "./types.ts";

interface CurvePoint {
  readonly value: number;
  readonly score: number;
}

const P95_CURVE: readonly CurvePoint[] = [
  { value: 0, score: 25 },
  { value: 300, score: 25 },
  { value: 600, score: 17 },
  { value: 1_200, score: 7 },
  { value: 2_000, score: 0 }
];

const AVERAGE_CURVE: readonly CurvePoint[] = [
  { value: 0, score: 15 },
  { value: 220, score: 15 },
  { value: 500, score: 8 },
  { value: 1_000, score: 2 },
  { value: 2_000, score: 0 }
];

const JITTER_CURVE: readonly CurvePoint[] = [
  { value: 0, score: 10 },
  { value: 60, score: 10 },
  { value: 180, score: 4 },
  { value: 600, score: 0 }
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreCurve(value: number | null, points: readonly CurvePoint[]): number {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (!previous || !current) {
      continue;
    }

    if (value <= current.value) {
      const span = current.value - previous.value;

      if (span === 0) {
        return current.score;
      }

      const position = (value - previous.value) / span;
      return previous.score + (current.score - previous.score) * position;
    }
  }

  return points.at(-1)?.score ?? 0;
}

function gradeFor(score: number): ScoreGrade {
  if (score >= 90) {
    return "excellent";
  }
  if (score >= 78) {
    return "good";
  }
  if (score >= 60) {
    return "fair";
  }
  if (score >= 40) {
    return "poor";
  }
  return "critical";
}

function validateCoverage(coverage: number): void {
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new RangeError("criticalEndpointCoverage must be between 0 and 1");
  }
}

export function scoreHttpsNetwork({
  metrics,
  criticalEndpointCoverage,
  primaryEndpointReachable
}: HttpsNetworkScoreInput): HttpsNetworkScore {
  validateCoverage(criticalEndpointCoverage);

  const successRate = metrics.successRate;
  const latency = metrics.latency;
  const dimensions: ScoreDimension[] = [
    {
      id: "success-rate",
      score: clamp((successRate ?? 0) * 40, 0, 40),
      maxScore: 40,
      measuredValue: successRate,
      unit: "ratio"
    },
    {
      id: "p95-latency",
      score: scoreCurve(latency?.p95Ms ?? null, P95_CURVE),
      maxScore: 25,
      measuredValue: latency?.p95Ms ?? null,
      unit: "ms"
    },
    {
      id: "average-latency",
      score: scoreCurve(latency?.averageMs ?? null, AVERAGE_CURVE),
      maxScore: 15,
      measuredValue: latency?.averageMs ?? null,
      unit: "ms"
    },
    {
      id: "jitter",
      score: scoreCurve(latency?.jitterMs ?? null, JITTER_CURVE),
      maxScore: 10,
      measuredValue: latency?.jitterMs ?? null,
      unit: "ms"
    },
    {
      id: "critical-endpoint-coverage",
      score: criticalEndpointCoverage * 10,
      maxScore: 10,
      measuredValue: criticalEndpointCoverage,
      unit: "ratio"
    }
  ];

  const rawScore = Math.round(
    dimensions.reduce((total, dimension) => total + dimension.score, 0)
  );
  const capsApplied: ScoreCap[] = [];

  if (metrics.failureCount > 0) {
    capsApplied.push({ id: "request-failure", maximumScore: 79 });
  }
  if (successRate !== null && successRate < 0.95) {
    capsApplied.push({ id: "success-below-95", maximumScore: 59 });
  }
  if (successRate !== null && successRate < 0.85) {
    capsApplied.push({ id: "success-below-85", maximumScore: 39 });
  }
  if (!primaryEndpointReachable) {
    capsApplied.push({ id: "primary-unreachable", maximumScore: 20 });
  }

  const cappedScore = capsApplied.reduce(
    (score, cap) => Math.min(score, cap.maximumScore),
    rawScore
  );
  const score = clamp(cappedScore, 0, 100);

  return {
    kind: "ai-https-network",
    confidence: "browser-basic",
    score,
    rawScore,
    grade: gradeFor(score),
    dimensions,
    capsApplied,
    unverifiedDimensions: ["realtime", "real-tool"]
  };
}
