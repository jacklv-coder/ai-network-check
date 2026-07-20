import {
  createBenchmarkReport,
  createEndpointBenchmarkReport,
  getPrimaryEndpoint,
  listServices,
  scoreHttpsNetwork,
  type AIServiceDefinition,
  type BenchmarkReport,
  type BenchmarkSample,
  type ReportLimitation,
  type ServiceBenchmarkReport
} from "../../core/src/index.ts";
import {
  runBrowserEndpointBenchmark,
  type BrowserEndpointBenchmarkResult
} from "../../web-benchmark/src/index.ts";
import type {
  ResolvedWebBenchmarkWorkflowOptions,
  WebBenchmarkWorkflowDependencies,
  WebBenchmarkWorkflowOptions
} from "./types.ts";

const DEFAULT_PRIMARY_SAMPLE_COUNT = 20;
const DEFAULT_SUPPORTING_SAMPLE_COUNT = 3;
const DEFAULT_TIMEOUT_MS = 7_000;
const DEFAULT_DELAY_MS = 180;

const DEFAULT_DEPENDENCIES: WebBenchmarkWorkflowDependencies = {
  listServices,
  runEndpointBenchmark: runBrowserEndpointBenchmark,
  now: () => new Date()
};

export class WebBenchmarkWorkflowCancelledError extends Error {
  override readonly name = "AbortError";

  constructor() {
    super("Web benchmark workflow was cancelled");
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WebBenchmarkWorkflowCancelledError();
  }
}

function resolveServices(
  catalog: readonly AIServiceDefinition[],
  serviceIds?: readonly string[]
): readonly AIServiceDefinition[] {
  if (serviceIds === undefined) {
    if (catalog.length === 0) {
      throw new Error("service catalog must not be empty");
    }
    return catalog;
  }

  if (serviceIds.length === 0) {
    throw new Error("serviceIds must contain at least one service");
  }

  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new Error("serviceIds must be unique");
  }

  return serviceIds.map((serviceId) => {
    const service = catalog.find((candidate) => candidate.id === serviceId);
    if (!service) {
      throw new Error(`Unknown service id: ${serviceId}`);
    }
    return service;
  });
}

export function resolveWebBenchmarkWorkflowOptions(
  options: WebBenchmarkWorkflowOptions,
  catalog: readonly AIServiceDefinition[]
): ResolvedWebBenchmarkWorkflowOptions {
  const primarySampleCount =
    options.primarySampleCount ?? DEFAULT_PRIMARY_SAMPLE_COUNT;
  const supportingSampleCount =
    options.supportingSampleCount ?? DEFAULT_SUPPORTING_SAMPLE_COUNT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  assertPositiveInteger(primarySampleCount, "primarySampleCount");
  assertPositiveInteger(supportingSampleCount, "supportingSampleCount");
  assertNonNegativeFinite(timeoutMs, "timeoutMs");
  if (timeoutMs === 0) {
    throw new RangeError("timeoutMs must be greater than zero");
  }
  assertNonNegativeFinite(delayMs, "delayMs");

  return {
    services: resolveServices(catalog, options.serviceIds),
    route: options.route?.trim() || null,
    primarySampleCount,
    supportingSampleCount,
    timeoutMs,
    delayMs,
    signal: options.signal,
    onProgress: options.onProgress
  };
}

function isReachable(result: BrowserEndpointBenchmarkResult): boolean {
  return result.metrics.successCount > 0;
}

function toBenchmarkSamples(
  result: BrowserEndpointBenchmarkResult
): readonly BenchmarkSample[] {
  return result.samples.map(({ status, durationMs }) => ({ status, durationMs }));
}

function criticalEndpointCoverage(
  service: AIServiceDefinition,
  results: readonly BrowserEndpointBenchmarkResult[]
): number {
  const criticalEndpoints = service.endpoints.filter((endpoint) => endpoint.critical);
  if (criticalEndpoints.length === 0) {
    return 1;
  }

  const reachableCount = criticalEndpoints.filter((endpoint) => {
    const result = results.find((candidate) => candidate.endpointId === endpoint.id);
    return result !== undefined && isReachable(result);
  }).length;

  return reachableCount / criticalEndpoints.length;
}

function reportLimitations(
  results: readonly BrowserEndpointBenchmarkResult[]
): readonly ReportLimitation[] {
  const limitations = new Set<ReportLimitation>([
    "network-phases-unverified",
    "websocket-unverified",
    "real-tool-unverified"
  ]);

  if (results.some((result) => result.httpStatusVerification === "unverified")) {
    limitations.add("http-status-unverified");
  }

  return [...limitations];
}

async function runServiceBenchmark(
  service: AIServiceDefinition,
  serviceIndex: number,
  options: ResolvedWebBenchmarkWorkflowOptions,
  dependencies: WebBenchmarkWorkflowDependencies
): Promise<{
  readonly report: ServiceBenchmarkReport;
  readonly results: readonly BrowserEndpointBenchmarkResult[];
}> {
  options.onProgress?.({
    type: "service-start",
    serviceId: service.id,
    serviceIndex,
    serviceCount: options.services.length
  });

  const primaryEndpoint = getPrimaryEndpoint(service);
  const results: BrowserEndpointBenchmarkResult[] = [];

  for (const [endpointIndex, endpoint] of service.endpoints.entries()) {
    assertNotCancelled(options.signal);

    const sampleCount =
      endpoint.id === primaryEndpoint.id
        ? options.primarySampleCount
        : options.supportingSampleCount;

    options.onProgress?.({
      type: "endpoint-start",
      serviceId: service.id,
      endpointId: endpoint.id,
      endpointIndex,
      endpointCount: service.endpoints.length,
      sampleCount
    });

    const result = await dependencies.runEndpointBenchmark({
      endpoint,
      options: {
        sampleCount,
        timeoutMs: options.timeoutMs,
        delayMs: options.delayMs,
        signal: options.signal,
        onProgress: (progress) => {
          options.onProgress?.({
            type: "endpoint-progress",
            serviceId: service.id,
            progress
          });
        }
      }
    });

    options.onProgress?.({
      type: "endpoint-complete",
      serviceId: service.id,
      result
    });

    if (result.cancelled || options.signal?.aborted) {
      throw new WebBenchmarkWorkflowCancelledError();
    }

    results.push(result);
  }

  const primaryResult = results.find(
    (result) => result.endpointId === primaryEndpoint.id
  );
  if (!primaryResult) {
    throw new Error(`Primary endpoint result missing for service ${service.id}`);
  }

  const coverage = criticalEndpointCoverage(service, results);
  const primaryEndpointReachable = isReachable(primaryResult);
  const report: ServiceBenchmarkReport = {
    serviceId: service.id,
    primaryEndpointReachable,
    criticalEndpointCoverage: coverage,
    endpoints: results.map((result) =>
      createEndpointBenchmarkReport({
        endpointId: result.endpointId,
        httpStatusVerification: result.httpStatusVerification,
        samples: toBenchmarkSamples(result)
      })
    ),
    score: scoreHttpsNetwork({
      metrics: primaryResult.metrics,
      criticalEndpointCoverage: coverage,
      primaryEndpointReachable
    })
  };

  options.onProgress?.({ type: "service-complete", service: report });

  return { report, results };
}

export async function runWebBenchmarkWorkflow(
  options: WebBenchmarkWorkflowOptions = {},
  dependencyOverrides: Partial<WebBenchmarkWorkflowDependencies> = {}
): Promise<BenchmarkReport> {
  const dependencies: WebBenchmarkWorkflowDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencyOverrides
  };
  const resolved = resolveWebBenchmarkWorkflowOptions(
    options,
    dependencies.listServices()
  );

  assertNotCancelled(resolved.signal);

  const startedAt = dependencies.now().toISOString();
  resolved.onProgress?.({
    type: "workflow-start",
    serviceCount: resolved.services.length
  });

  const services: ServiceBenchmarkReport[] = [];
  const endpointResults: BrowserEndpointBenchmarkResult[] = [];

  for (const [serviceIndex, service] of resolved.services.entries()) {
    const result = await runServiceBenchmark(
      service,
      serviceIndex,
      resolved,
      dependencies
    );
    services.push(result.report);
    endpointResults.push(...result.results);
  }

  assertNotCancelled(resolved.signal);

  const report = createBenchmarkReport({
    mode: "web",
    confidence: "browser-basic",
    route: resolved.route,
    startedAt,
    completedAt: dependencies.now().toISOString(),
    services,
    limitations: reportLimitations(endpointResults)
  });

  resolved.onProgress?.({ type: "workflow-complete", report });
  return report;
}
