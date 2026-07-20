import { AI_SERVICE_CATALOG } from "./services.ts";
import type { AIServiceDefinition, ProviderId, ServiceEndpoint } from "./types.ts";

export function listServices(): readonly AIServiceDefinition[] {
  return AI_SERVICE_CATALOG;
}

export function getService(serviceId: string): AIServiceDefinition | undefined {
  return AI_SERVICE_CATALOG.find((service) => service.id === serviceId);
}

export function listServicesByProvider(
  provider: ProviderId
): readonly AIServiceDefinition[] {
  return AI_SERVICE_CATALOG.filter((service) => service.provider === provider);
}

export function getPrimaryEndpoint(
  service: AIServiceDefinition
): ServiceEndpoint {
  const endpoint = service.endpoints.find((candidate) => candidate.role === "primary");

  if (!endpoint) {
    throw new Error(`Service ${service.id} does not define a primary endpoint`);
  }

  return endpoint;
}

export function validateServiceCatalog(
  services: readonly AIServiceDefinition[] = AI_SERVICE_CATALOG
): readonly string[] {
  const errors: string[] = [];
  const serviceIds = new Set<string>();
  const endpointIds = new Set<string>();

  for (const service of services) {
    if (serviceIds.has(service.id)) {
      errors.push(`Duplicate service id: ${service.id}`);
    }
    serviceIds.add(service.id);

    const primaryCount = service.endpoints.filter(
      (endpoint) => endpoint.role === "primary"
    ).length;

    if (primaryCount !== 1) {
      errors.push(
        `Service ${service.id} must define exactly one primary endpoint; found ${primaryCount}`
      );
    }

    if (service.endpoints.length === 0) {
      errors.push(`Service ${service.id} must define at least one endpoint`);
    }

    for (const endpoint of service.endpoints) {
      if (endpointIds.has(endpoint.id)) {
        errors.push(`Duplicate endpoint id: ${endpoint.id}`);
      }
      endpointIds.add(endpoint.id);

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(endpoint.url);
      } catch {
        errors.push(`Endpoint ${endpoint.id} has an invalid URL`);
        continue;
      }

      if (parsedUrl.protocol !== "https:") {
        errors.push(`Endpoint ${endpoint.id} must use HTTPS`);
      }
    }
  }

  return errors;
}
