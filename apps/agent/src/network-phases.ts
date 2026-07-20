import type { AIServiceDefinition } from "../../../packages/core/src/index.ts";
import type {
  NetworkPhaseBenchmarkOptions,
  NetworkPhaseBenchmarkResult
} from "../../../packages/network-phase-benchmark/src/index.ts";
import type {
  NetworkPhaseEndpointApiResult,
  NetworkPhaseServiceApiResponse
} from "./types.ts";

export interface CatalogNetworkPhaseDependencies {
  readonly runNetworkPhaseBenchmark: (
    options: NetworkPhaseBenchmarkOptions
  ) => Promise<NetworkPhaseBenchmarkResult>;
}

export async function runCatalogNetworkPhaseBenchmark(
  service: AIServiceDefinition,
  signal: AbortSignal,
  dependencies: CatalogNetworkPhaseDependencies
): Promise<NetworkPhaseServiceApiResponse> {
  const endpoints: NetworkPhaseEndpointApiResult[] = [];

  for (const endpoint of service.endpoints) {
    if (signal.aborted) break;

    const result = await dependencies.runNetworkPhaseBenchmark({
      url: endpoint.url,
      timeoutMs: 15_000,
      signal
    });

    endpoints.push({
      endpointId: endpoint.id,
      label: endpoint.label,
      role: endpoint.role,
      critical: endpoint.critical,
      result
    });

    if (result.status === "cancelled") break;
  }

  return {
    source: "service-catalog",
    serviceId: service.id,
    displayName: service.displayName,
    cancelled: signal.aborted || endpoints.some((item) => item.result.status === "cancelled"),
    endpoints
  };
}
