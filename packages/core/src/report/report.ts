import { summarizeBenchmarkSamples } from "../metrics/metrics.ts";
import { BENCHMARK_SAMPLE_STATUSES } from "../metrics/types.ts";
import type { ScoreConfidence } from "../scoring/types.ts";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  type BenchmarkMode,
  type BenchmarkReport,
  type CreateBenchmarkReportInput,
  type CreateEndpointBenchmarkReportInput,
  type EndpointBenchmarkReport
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function confidenceMatchesMode(
  mode: BenchmarkMode,
  confidence: ScoreConfidence
): boolean {
  return mode === "web"
    ? confidence === "browser-basic" || confidence === "browser-realtime"
    : confidence === "local-network" || confidence === "local-real-tool";
}

function assertUniqueIds(values: readonly string[], label: string): void {
  const unique = new Set(values);

  if (unique.size !== values.length) {
    throw new Error(`${label} must be unique`);
  }
}

export function createEndpointBenchmarkReport({
  endpointId,
  httpStatusVerification,
  samples
}: CreateEndpointBenchmarkReportInput): EndpointBenchmarkReport {
  if (!endpointId.trim()) {
    throw new Error("endpointId must not be empty");
  }

  return {
    endpointId,
    httpStatusVerification,
    samples: samples.map((sample) => ({ ...sample })),
    metrics: summarizeBenchmarkSamples(samples)
  };
}

export function createBenchmarkReport({
  mode,
  confidence,
  route,
  startedAt,
  completedAt,
  services,
  limitations
}: CreateBenchmarkReportInput): BenchmarkReport {
  if (!confidenceMatchesMode(mode, confidence)) {
    throw new Error(`confidence ${confidence} is incompatible with mode ${mode}`);
  }

  if (!isValidIsoDate(startedAt) || !isValidIsoDate(completedAt)) {
    throw new Error("startedAt and completedAt must be valid ISO timestamps");
  }

  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("completedAt must not be earlier than startedAt");
  }

  assertUniqueIds(
    services.map((service) => service.serviceId),
    "service ids"
  );

  for (const service of services) {
    if (
      !Number.isFinite(service.criticalEndpointCoverage) ||
      service.criticalEndpointCoverage < 0 ||
      service.criticalEndpointCoverage > 1
    ) {
      throw new RangeError(
        `service ${service.serviceId} criticalEndpointCoverage must be between 0 and 1`
      );
    }

    assertUniqueIds(
      service.endpoints.map((endpoint) => endpoint.endpointId),
      `endpoint ids for service ${service.serviceId}`
    );

    if (service.score && service.score.confidence !== confidence) {
      throw new Error(
        `service ${service.serviceId} score confidence must match report confidence`
      );
    }
  }

  return {
    schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
    mode,
    confidence,
    route: route?.trim() || null,
    startedAt,
    completedAt,
    services: services.map((service) => ({
      ...service,
      endpoints: service.endpoints.map((endpoint) => ({
        ...endpoint,
        samples: endpoint.samples.map((sample) => ({ ...sample }))
      }))
    })),
    limitations: [...new Set(limitations)]
  };
}

export function serializeBenchmarkReport(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

export function validateBenchmarkReport(value: unknown): readonly string[] {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return ["report must be an object"];
  }

  if (value.schemaVersion !== BENCHMARK_REPORT_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion: ${String(value.schemaVersion)}`);
  }

  if (value.mode !== "web" && value.mode !== "local") {
    errors.push("mode must be web or local");
  }

  const confidence = value.confidence;
  const validConfidences: readonly ScoreConfidence[] = [
    "browser-basic",
    "browser-realtime",
    "local-network",
    "local-real-tool"
  ];

  if (!validConfidences.includes(confidence as ScoreConfidence)) {
    errors.push("confidence is invalid");
  } else if (
    (value.mode === "web" || value.mode === "local") &&
    !confidenceMatchesMode(value.mode, confidence as ScoreConfidence)
  ) {
    errors.push("confidence is incompatible with mode");
  }

  if (typeof value.startedAt !== "string" || !isValidIsoDate(value.startedAt)) {
    errors.push("startedAt must be a valid timestamp");
  }
  if (typeof value.completedAt !== "string" || !isValidIsoDate(value.completedAt)) {
    errors.push("completedAt must be a valid timestamp");
  }
  if (
    typeof value.startedAt === "string" &&
    typeof value.completedAt === "string" &&
    isValidIsoDate(value.startedAt) &&
    isValidIsoDate(value.completedAt) &&
    Date.parse(value.completedAt) < Date.parse(value.startedAt)
  ) {
    errors.push("completedAt must not be earlier than startedAt");
  }

  if (value.route !== null && typeof value.route !== "string") {
    errors.push("route must be a string or null");
  }

  if (!Array.isArray(value.limitations)) {
    errors.push("limitations must be an array");
  }

  if (!Array.isArray(value.services)) {
    errors.push("services must be an array");
    return errors;
  }

  const serviceIds = new Set<string>();

  value.services.forEach((service, serviceIndex) => {
    if (!isRecord(service)) {
      errors.push(`services[${serviceIndex}] must be an object`);
      return;
    }

    if (typeof service.serviceId !== "string" || !service.serviceId.trim()) {
      errors.push(`services[${serviceIndex}].serviceId is invalid`);
    } else if (serviceIds.has(service.serviceId)) {
      errors.push(`duplicate serviceId: ${service.serviceId}`);
    } else {
      serviceIds.add(service.serviceId);
    }

    if (
      typeof service.criticalEndpointCoverage !== "number" ||
      service.criticalEndpointCoverage < 0 ||
      service.criticalEndpointCoverage > 1
    ) {
      errors.push(
        `services[${serviceIndex}].criticalEndpointCoverage must be between 0 and 1`
      );
    }

    if (typeof service.primaryEndpointReachable !== "boolean") {
      errors.push(`services[${serviceIndex}].primaryEndpointReachable is invalid`);
    }

    if (!Array.isArray(service.endpoints)) {
      errors.push(`services[${serviceIndex}].endpoints must be an array`);
      return;
    }

    const endpointIds = new Set<string>();

    service.endpoints.forEach((endpoint, endpointIndex) => {
      if (!isRecord(endpoint)) {
        errors.push(
          `services[${serviceIndex}].endpoints[${endpointIndex}] must be an object`
        );
        return;
      }

      if (typeof endpoint.endpointId !== "string" || !endpoint.endpointId.trim()) {
        errors.push(
          `services[${serviceIndex}].endpoints[${endpointIndex}].endpointId is invalid`
        );
      } else if (endpointIds.has(endpoint.endpointId)) {
        errors.push(`duplicate endpointId: ${endpoint.endpointId}`);
      } else {
        endpointIds.add(endpoint.endpointId);
      }

      if (!Array.isArray(endpoint.samples)) {
        errors.push(
          `services[${serviceIndex}].endpoints[${endpointIndex}].samples must be an array`
        );
        return;
      }

      endpoint.samples.forEach((sample, sampleIndex) => {
        if (!isRecord(sample)) {
          errors.push(
            `services[${serviceIndex}].endpoints[${endpointIndex}].samples[${sampleIndex}] must be an object`
          );
          return;
        }

        if (!BENCHMARK_SAMPLE_STATUSES.includes(sample.status as never)) {
          errors.push(
            `services[${serviceIndex}].endpoints[${endpointIndex}].samples[${sampleIndex}].status is invalid`
          );
        }
        if (
          typeof sample.durationMs !== "number" ||
          !Number.isFinite(sample.durationMs) ||
          sample.durationMs < 0
        ) {
          errors.push(
            `services[${serviceIndex}].endpoints[${endpointIndex}].samples[${sampleIndex}].durationMs is invalid`
          );
        }
      });
    });
  });

  return errors;
}

export function parseBenchmarkReport(json: string): BenchmarkReport {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SyntaxError("benchmark report is not valid JSON");
  }

  const errors = validateBenchmarkReport(parsed);

  if (errors.length > 0) {
    throw new Error(`invalid benchmark report: ${errors.join("; ")}`);
  }

  return parsed as BenchmarkReport;
}
