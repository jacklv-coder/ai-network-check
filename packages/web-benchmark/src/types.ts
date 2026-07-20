import type {
  BenchmarkMetrics,
  BenchmarkSampleStatus,
  ServiceEndpoint
} from "../../core/src/index.ts";

export interface BrowserProbeSample {
  readonly index: number;
  readonly status: BenchmarkSampleStatus;
  readonly durationMs: number;
  readonly httpStatus: number | null;
}

export interface BrowserBenchmarkProgress {
  readonly endpointId: string;
  readonly completedSamples: number;
  readonly totalSamples: number;
  readonly latestSample: BrowserProbeSample;
  readonly metrics: BenchmarkMetrics;
}

export interface BrowserEndpointBenchmarkResult {
  readonly endpointId: string;
  readonly samples: readonly BrowserProbeSample[];
  readonly metrics: BenchmarkMetrics;
  readonly cancelled: boolean;
  readonly httpStatusVerification: "verified" | "unverified";
}

export interface BrowserBenchmarkOptions {
  readonly sampleCount: number;
  readonly timeoutMs: number;
  readonly delayMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BrowserBenchmarkProgress) => void;
}

export interface BrowserBenchmarkDependencies {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  readonly createCacheBustToken: (sampleIndex: number) => string;
}

export interface BrowserEndpointBenchmarkInput {
  readonly endpoint: ServiceEndpoint;
  readonly options: BrowserBenchmarkOptions;
  readonly dependencies?: Partial<BrowserBenchmarkDependencies>;
}
