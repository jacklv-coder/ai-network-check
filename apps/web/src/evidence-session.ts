import {
  listServices,
  type BenchmarkReport
} from "@ai-network-check/core";
import {
  createEvidenceReport,
  upsertLocalNetworkEvidence,
  upsertRealToolEvidence,
  withPublicWebSocketEvidence,
  withWebReport,
  type EvidenceLimitation,
  type EvidenceReport
} from "@ai-network-check/evidence-report";
import type { WebSocketBenchmarkResult } from "@ai-network-check/websocket-benchmark";

import type {
  CodexBenchmarkApiResponse,
  NetworkPhaseServiceApiResponse
} from "./agent-client.ts";

export interface EvidenceCoverage {
  readonly webHttps: boolean;
  readonly publicWebSocket: boolean;
  readonly localNetworkServiceCount: number;
  readonly expectedLocalNetworkServiceCount: number;
  readonly realCodex: boolean;
}

export interface EvidenceSessionSnapshot {
  readonly report: EvidenceReport;
  readonly coverage: EvidenceCoverage;
  readonly hasEvidence: boolean;
}

export interface EvidenceSessionOptions {
  readonly now?: () => string;
  readonly expectedServiceIds?: readonly string[];
}

export interface EvidenceSession {
  readonly snapshot: () => EvidenceSessionSnapshot;
  readonly attachWebReport: (report: BenchmarkReport) => void;
  readonly attachPublicWebSocket: (result: WebSocketBenchmarkResult) => void;
  readonly attachLocalNetwork: (result: NetworkPhaseServiceApiResponse) => void;
  readonly attachCodex: (result: CodexBenchmarkApiResponse) => void;
  readonly reset: () => void;
  readonly subscribe: (
    listener: (snapshot: EvidenceSessionSnapshot) => void
  ) => () => void;
}

function completedLocalServiceCount(
  report: Pick<EvidenceReport, "localNetwork">
): number {
  return report.localNetwork.filter((item) => !item.cancelled).length;
}

function deriveLimitations(
  report: Pick<
    EvidenceReport,
    "webReport" | "publicWebSocket" | "localNetwork" | "realTools"
  >,
  expectedServiceCount: number
): readonly EvidenceLimitation[] {
  const limitations: EvidenceLimitation[] = [
    "ai-internal-websocket-unverified"
  ];

  if (report.webReport) {
    limitations.push("browser-http-status-unverified");
  }
  if (report.publicWebSocket) {
    limitations.push("public-websocket-only");
  }
  if (completedLocalServiceCount(report) < expectedServiceCount) {
    limitations.push("local-network-phases-partial");
  }
  if (!report.realTools.some((item) => item.tool === "codex")) {
    limitations.push("real-tool-not-run");
  }
  return limitations;
}

export function createEvidenceSession(
  options: EvidenceSessionOptions = {}
): EvidenceSession {
  const now = options.now ?? (() => new Date().toISOString());
  const expectedServiceIds = new Set(options.expectedServiceIds ?? []);
  const listeners = new Set<(snapshot: EvidenceSessionSnapshot) => void>();

  const newEmptyReport = (): EvidenceReport =>
    createEvidenceReport({
      createdAt: now(),
      limitations: deriveLimitations(
        {
          webReport: null,
          publicWebSocket: null,
          localNetwork: [],
          realTools: []
        },
        expectedServiceIds.size
      )
    });

  let report = newEmptyReport();

  const currentSnapshot = (): EvidenceSessionSnapshot => {
    const coverage: EvidenceCoverage = {
      webHttps: report.webReport !== null,
      publicWebSocket: report.publicWebSocket !== null,
      localNetworkServiceCount: completedLocalServiceCount(report),
      expectedLocalNetworkServiceCount: expectedServiceIds.size,
      realCodex: report.realTools.some((item) => item.tool === "codex")
    };
    return {
      report,
      coverage,
      hasEvidence:
        coverage.webHttps ||
        coverage.publicWebSocket ||
        report.localNetwork.length > 0 ||
        coverage.realCodex
    };
  };

  const publish = (): void => {
    const snapshot = currentSnapshot();
    listeners.forEach((listener) => listener(snapshot));
  };

  const normalizeLimitations = (candidate: EvidenceReport): EvidenceReport =>
    createEvidenceReport({
      ...candidate,
      limitations: deriveLimitations(candidate, expectedServiceIds.size)
    });

  return {
    snapshot: currentSnapshot,
    attachWebReport(webReport) {
      report = withWebReport(report, webReport);
      report = createEvidenceReport({
        ...report,
        route: webReport.route,
        limitations: deriveLimitations(report, expectedServiceIds.size)
      });
      publish();
    },
    attachPublicWebSocket(result) {
      report = withPublicWebSocketEvidence(report, {
        kind: "public-websocket",
        provider: "postman-echo",
        verifiedScope: "public-echo-only",
        collectedAt: now(),
        result
      });
      report = normalizeLimitations(report);
      publish();
    },
    attachLocalNetwork(result) {
      report = upsertLocalNetworkEvidence(report, {
        kind: "local-network-phases",
        source: "service-catalog",
        serviceId: result.serviceId,
        displayName: result.displayName,
        collectedAt: now(),
        cancelled: result.cancelled,
        endpoints: result.endpoints.map((endpoint) => ({
          endpointId: endpoint.endpointId,
          label: endpoint.label,
          role: endpoint.role,
          critical: endpoint.critical,
          result: endpoint.result
        }))
      });
      report = normalizeLimitations(report);
      publish();
    },
    attachCodex(result) {
      report = upsertRealToolEvidence(report, {
        kind: "real-tool",
        tool: "codex",
        promptId: result.promptId,
        collectedAt: now(),
        result: result.result
      });
      report = normalizeLimitations(report);
      publish();
    },
    reset() {
      report = newEmptyReport();
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(currentSnapshot());
      return () => listeners.delete(listener);
    }
  };
}

export const evidenceSession = createEvidenceSession({
  expectedServiceIds: listServices().map((service) => service.id)
});
