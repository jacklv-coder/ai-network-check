import {
  summarizeBenchmarkSamples,
  type BenchmarkSample,
  type ServiceEndpoint
} from "../../core/src/index.ts";
import type {
  BrowserBenchmarkDependencies,
  BrowserBenchmarkOptions,
  BrowserEndpointBenchmarkInput,
  BrowserEndpointBenchmarkResult,
  BrowserProbeSample
} from "./types.ts";

const CACHE_BUST_PARAMETER = "__anc_probe";

function defaultSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, durationMs);

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    }
  });
}

const DEFAULT_DEPENDENCIES: BrowserBenchmarkDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => globalThis.performance.now(),
  sleep: defaultSleep,
  createCacheBustToken: (sampleIndex) =>
    `${Date.now().toString(36)}-${sampleIndex.toString(36)}`
};

function validateOptions(options: BrowserBenchmarkOptions): void {
  if (!Number.isInteger(options.sampleCount) || options.sampleCount <= 0) {
    throw new RangeError("sampleCount must be a positive integer");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }

  if (
    options.delayMs !== undefined &&
    (!Number.isFinite(options.delayMs) || options.delayMs < 0)
  ) {
    throw new RangeError("delayMs must be a finite non-negative number");
  }
}

export function createBrowserProbeUrl(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(CACHE_BUST_PARAMETER, token);
  return parsed.toString();
}

async function probeEndpoint(
  endpoint: ServiceEndpoint,
  sampleIndex: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  dependencies: BrowserBenchmarkDependencies
): Promise<BrowserProbeSample> {
  if (signal?.aborted) {
    return {
      index: sampleIndex,
      status: "cancelled",
      durationMs: 0,
      httpStatus: null
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const startedAt = dependencies.now();

  try {
    const response = await dependencies.fetch(
      createBrowserProbeUrl(
        endpoint.url,
        dependencies.createCacheBustToken(sampleIndex)
      ),
      {
        method: "GET",
        mode: endpoint.browserRequestMode,
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      }
    );
    const durationMs = Math.max(0, dependencies.now() - startedAt);

    if (signal?.aborted) {
      return {
        index: sampleIndex,
        status: "cancelled",
        durationMs,
        httpStatus: null
      };
    }

    if (timedOut) {
      return {
        index: sampleIndex,
        status: "timeout",
        durationMs,
        httpStatus: null
      };
    }

    if (endpoint.browserRequestMode === "cors" && !response.ok) {
      return {
        index: sampleIndex,
        status: "protocol-error",
        durationMs,
        httpStatus: response.status
      };
    }

    return {
      index: sampleIndex,
      status: "success",
      durationMs,
      httpStatus:
        endpoint.browserRequestMode === "cors" ? response.status : null
    };
  } catch {
    const durationMs = Math.max(0, dependencies.now() - startedAt);

    return {
      index: sampleIndex,
      status: signal?.aborted
        ? "cancelled"
        : timedOut
          ? "timeout"
          : "network-error",
      durationMs,
      httpStatus: null
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function toMetricSamples(
  samples: readonly BrowserProbeSample[]
): readonly BenchmarkSample[] {
  return samples.map(({ status, durationMs }) => ({ status, durationMs }));
}

export async function runBrowserEndpointBenchmark({
  endpoint,
  options,
  dependencies: dependencyOverrides
}: BrowserEndpointBenchmarkInput): Promise<BrowserEndpointBenchmarkResult> {
  validateOptions(options);

  const dependencies: BrowserBenchmarkDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencyOverrides
  };
  const samples: BrowserProbeSample[] = [];
  const delayMs = options.delayMs ?? 0;

  for (let index = 0; index < options.sampleCount; index += 1) {
    if (options.signal?.aborted) {
      break;
    }

    const sample = await probeEndpoint(
      endpoint,
      index,
      options.timeoutMs,
      options.signal,
      dependencies
    );
    samples.push(sample);

    const metrics = summarizeBenchmarkSamples(toMetricSamples(samples));
    options.onProgress?.({
      endpointId: endpoint.id,
      completedSamples: samples.length,
      totalSamples: options.sampleCount,
      latestSample: sample,
      metrics
    });

    if (sample.status === "cancelled" || options.signal?.aborted) {
      break;
    }

    if (delayMs > 0 && index < options.sampleCount - 1) {
      await dependencies.sleep(delayMs, options.signal);
    }
  }

  return {
    endpointId: endpoint.id,
    samples,
    metrics: summarizeBenchmarkSamples(toMetricSamples(samples)),
    cancelled: options.signal?.aborted ?? false,
    httpStatusVerification:
      endpoint.browserRequestMode === "cors" ? "verified" : "unverified"
  };
}
