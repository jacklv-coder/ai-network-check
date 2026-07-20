import {
  serializeBenchmarkReport,
  validateBenchmarkReport
} from "../../core/src/index.ts";
import {
  EVIDENCE_REPORT_KIND,
  EVIDENCE_REPORT_SCHEMA_VERSION,
  type CreateEvidenceReportInput,
  type EvidenceLimitation,
  type EvidenceReport,
  type LocalNetworkServiceEvidence,
  type PublicWebSocketEvidence,
  type RealToolEvidence
} from "./types.ts";

const EVIDENCE_LIMITATIONS: readonly EvidenceLimitation[] = [
  "browser-http-status-unverified",
  "public-websocket-only",
  "ai-internal-websocket-unverified",
  "local-network-phases-partial",
  "real-tool-not-run"
];

const WEBSOCKET_STATUSES = [
  "completed",
  "handshake-timeout",
  "connection-error",
  "closed-early"
] as const;
const NETWORK_PHASE_STATUSES = [
  "success",
  "dns-error",
  "tcp-error",
  "tls-error",
  "timeout",
  "cancelled",
  "request-error"
] as const;
const CODEX_STATUSES = [
  "success",
  "not-installed",
  "not-authenticated",
  "timeout",
  "cancelled",
  "output-limit",
  "failed"
] as const;
const FORBIDDEN_SENSITIVE_KEYS = new Set([
  "token",
  "authorization",
  "stdout",
  "stderr",
  "prompt",
  "responsetext",
  "modelresponse"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findSensitiveKeys(
  value: unknown,
  path = "report",
  errors: string[] = []
): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findSensitiveKeys(item, `${path}[${index}]`, errors)
    );
    return errors;
  }
  if (!isRecord(value)) return errors;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SENSITIVE_KEYS.has(key.toLowerCase())) {
      errors.push(`${path}.${key} is not allowed in evidence reports`);
    }
    findSensitiveKeys(nested, `${path}.${key}`, errors);
  }
  return errors;
}

function validateWebSocketEvidence(value: unknown, errors: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) {
    errors.push("publicWebSocket must be an object or null");
    return;
  }
  if (value.kind !== "public-websocket") {
    errors.push("publicWebSocket.kind must be public-websocket");
  }
  if (value.provider !== "postman-echo") {
    errors.push("publicWebSocket.provider must be postman-echo");
  }
  if (value.verifiedScope !== "public-echo-only") {
    errors.push("publicWebSocket.verifiedScope must be public-echo-only");
  }
  if (!isIsoDate(value.collectedAt)) {
    errors.push("publicWebSocket.collectedAt must be a valid timestamp");
  }
  if (!isRecord(value.result)) {
    errors.push("publicWebSocket.result must be an object");
    return;
  }

  const result = value.result;
  if (!isOneOf(result.status, WEBSOCKET_STATUSES)) {
    errors.push("publicWebSocket.result.status is invalid");
  }
  for (const key of [
    "connectionDurationMs",
    "targetDurationMs"
  ] as const) {
    if (!isNonNegativeNumber(result[key])) {
      errors.push(`publicWebSocket.result.${key} must be non-negative`);
    }
  }
  if (
    result.handshakeMs !== null &&
    !isNonNegativeNumber(result.handshakeMs)
  ) {
    errors.push("publicWebSocket.result.handshakeMs must be non-negative or null");
  }
  for (const key of ["sentCount", "receivedCount", "lostCount"] as const) {
    if (!isNonNegativeInteger(result[key])) {
      errors.push(`publicWebSocket.result.${key} must be a non-negative integer`);
    }
  }
}

function validateNetworkEvidence(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("localNetwork must be an array");
    return;
  }
  const serviceIds = new Set<string>();

  value.forEach((service, serviceIndex) => {
    const path = `localNetwork[${serviceIndex}]`;
    if (!isRecord(service)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (service.kind !== "local-network-phases") {
      errors.push(`${path}.kind must be local-network-phases`);
    }
    if (service.source !== "service-catalog") {
      errors.push(`${path}.source must be service-catalog`);
    }
    if (typeof service.serviceId !== "string" || !service.serviceId.trim()) {
      errors.push(`${path}.serviceId must not be empty`);
    } else if (serviceIds.has(service.serviceId)) {
      errors.push(`duplicate local network service: ${service.serviceId}`);
    } else {
      serviceIds.add(service.serviceId);
    }
    if (!isIsoDate(service.collectedAt)) {
      errors.push(`${path}.collectedAt must be a valid timestamp`);
    }
    if (!Array.isArray(service.endpoints)) {
      errors.push(`${path}.endpoints must be an array`);
      return;
    }

    const endpointIds = new Set<string>();
    service.endpoints.forEach((endpoint, endpointIndex) => {
      const endpointPath = `${path}.endpoints[${endpointIndex}]`;
      if (!isRecord(endpoint)) {
        errors.push(`${endpointPath} must be an object`);
        return;
      }
      if (
        typeof endpoint.endpointId !== "string" ||
        !endpoint.endpointId.trim()
      ) {
        errors.push(`${endpointPath}.endpointId must not be empty`);
      } else if (endpointIds.has(endpoint.endpointId)) {
        errors.push(`duplicate local network endpoint: ${endpoint.endpointId}`);
      } else {
        endpointIds.add(endpoint.endpointId);
      }
      if (!isRecord(endpoint.result)) {
        errors.push(`${endpointPath}.result must be an object`);
        return;
      }
      const result = endpoint.result;
      if (!isOneOf(result.status, NETWORK_PHASE_STATUSES)) {
        errors.push(`${endpointPath}.result.status is invalid`);
      }
      if (typeof result.url !== "string") {
        errors.push(`${endpointPath}.result.url must be a string`);
      } else {
        try {
          if (new URL(result.url).protocol !== "https:") {
            errors.push(`${endpointPath}.result.url must use HTTPS`);
          }
        } catch {
          errors.push(`${endpointPath}.result.url must be valid`);
        }
      }
      if (result.phases !== null) {
        if (!isRecord(result.phases)) {
          errors.push(`${endpointPath}.result.phases must be an object or null`);
        } else {
          for (const key of [
            "dnsMs",
            "tcpMs",
            "tlsMs",
            "requestToFirstByteMs",
            "totalToFirstByteMs"
          ] as const) {
            if (!isNonNegativeNumber(result.phases[key])) {
              errors.push(`${endpointPath}.result.phases.${key} must be non-negative`);
            }
          }
        }
      }
    });
  });
}

function validateRealTools(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("realTools must be an array");
    return;
  }
  const tools = new Set<string>();

  value.forEach((evidence, index) => {
    const path = `realTools[${index}]`;
    if (!isRecord(evidence)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (evidence.kind !== "real-tool" || evidence.tool !== "codex") {
      errors.push(`${path} must describe the codex real tool`);
    }
    if (tools.has(String(evidence.tool))) {
      errors.push(`duplicate real tool: ${String(evidence.tool)}`);
    }
    tools.add(String(evidence.tool));
    if (typeof evidence.promptId !== "string" || !evidence.promptId.trim()) {
      errors.push(`${path}.promptId must not be empty`);
    }
    if (!isIsoDate(evidence.collectedAt)) {
      errors.push(`${path}.collectedAt must be a valid timestamp`);
    }
    if (!isRecord(evidence.result)) {
      errors.push(`${path}.result must be an object`);
      return;
    }
    if (!isOneOf(evidence.result.status, CODEX_STATUSES)) {
      errors.push(`${path}.result.status is invalid`);
    }
    if (!isNonNegativeNumber(evidence.result.durationMs)) {
      errors.push(`${path}.result.durationMs must be non-negative`);
    }
    for (const key of ["firstEventMs", "firstAgentMessageMs"] as const) {
      const timing = evidence.result[key];
      if (timing !== null && !isNonNegativeNumber(timing)) {
        errors.push(`${path}.result.${key} must be non-negative or null`);
      }
    }
  });
}

export function validateEvidenceReport(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["evidence report must be an object"];

  if (value.schemaVersion !== EVIDENCE_REPORT_SCHEMA_VERSION) {
    errors.push(`unsupported evidence schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (value.kind !== EVIDENCE_REPORT_KIND) {
    errors.push(`kind must be ${EVIDENCE_REPORT_KIND}`);
  }
  if (!isIsoDate(value.createdAt)) {
    errors.push("createdAt must be a valid timestamp");
  }
  if (value.route !== null && typeof value.route !== "string") {
    errors.push("route must be a string or null");
  }

  if (value.webReport !== null) {
    const webErrors = validateBenchmarkReport(value.webReport);
    errors.push(...webErrors.map((error) => `webReport: ${error}`));
  }
  validateWebSocketEvidence(value.publicWebSocket, errors);
  validateNetworkEvidence(value.localNetwork, errors);
  validateRealTools(value.realTools, errors);

  if (!Array.isArray(value.limitations)) {
    errors.push("limitations must be an array");
  } else {
    value.limitations.forEach((limitation, index) => {
      if (!isOneOf(limitation, EVIDENCE_LIMITATIONS)) {
        errors.push(`limitations[${index}] is invalid`);
      }
    });
  }

  errors.push(...findSensitiveKeys(value));
  return errors;
}

export function createEvidenceReport(
  input: CreateEvidenceReportInput
): EvidenceReport {
  const webReport = input.webReport
    ? (JSON.parse(serializeBenchmarkReport(input.webReport)) as EvidenceReport["webReport"])
    : null;
  const report: EvidenceReport = {
    schemaVersion: EVIDENCE_REPORT_SCHEMA_VERSION,
    kind: EVIDENCE_REPORT_KIND,
    createdAt: input.createdAt,
    route: input.route?.trim() || null,
    webReport,
    publicWebSocket: input.publicWebSocket
      ? deepClone(input.publicWebSocket)
      : null,
    localNetwork: deepClone(input.localNetwork ?? []),
    realTools: deepClone(input.realTools ?? []),
    limitations: [...new Set(input.limitations ?? [])]
  };

  const errors = validateEvidenceReport(report);
  if (errors.length) {
    throw new Error(`Invalid evidence report: ${errors.join("; ")}`);
  }
  return report;
}

export function serializeEvidenceReport(report: EvidenceReport): string {
  const errors = validateEvidenceReport(report);
  if (errors.length) {
    throw new Error(`Invalid evidence report: ${errors.join("; ")}`);
  }
  return JSON.stringify(report, null, 2);
}

export function parseEvidenceReport(json: string): EvidenceReport {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new SyntaxError("Evidence report is not valid JSON");
  }
  const errors = validateEvidenceReport(value);
  if (errors.length) {
    throw new Error(`Invalid evidence report: ${errors.join("; ")}`);
  }
  return deepClone(value as EvidenceReport);
}

export function withWebReport(
  report: EvidenceReport,
  webReport: EvidenceReport["webReport"]
): EvidenceReport {
  return createEvidenceReport({ ...report, webReport });
}

export function withPublicWebSocketEvidence(
  report: EvidenceReport,
  publicWebSocket: PublicWebSocketEvidence | null
): EvidenceReport {
  return createEvidenceReport({ ...report, publicWebSocket });
}

export function upsertLocalNetworkEvidence(
  report: EvidenceReport,
  evidence: LocalNetworkServiceEvidence
): EvidenceReport {
  return createEvidenceReport({
    ...report,
    localNetwork: [
      ...report.localNetwork.filter(
        (item) => item.serviceId !== evidence.serviceId
      ),
      evidence
    ]
  });
}

export function upsertRealToolEvidence(
  report: EvidenceReport,
  evidence: RealToolEvidence
): EvidenceReport {
  return createEvidenceReport({
    ...report,
    realTools: [
      ...report.realTools.filter((item) => item.tool !== evidence.tool),
      evidence
    ]
  });
}
