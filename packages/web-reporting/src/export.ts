import {
  serializeBenchmarkReport,
  type BenchmarkReport
} from "../../core/src/index.ts";
import type { BenchmarkReportExport } from "./types.ts";

function safeFilenameSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return segment || "unnamed-route";
}

function timestampForFilename(value: string): string {
  return value.replace(/[:.]/g, "-");
}

export function createJsonReportExport(
  report: BenchmarkReport
): BenchmarkReportExport {
  return {
    filename: `ai-network-check-${safeFilenameSegment(report.route ?? "unnamed-route")}-${timestampForFilename(report.completedAt)}.json`,
    mimeType: "application/json",
    content: serializeBenchmarkReport(report)
  };
}

export function createTextReportSummary(report: BenchmarkReport): string {
  const lines = [
    "AI Network Check",
    `Route: ${report.route ?? "Unnamed route"}`,
    `Mode: ${report.mode}`,
    `Confidence: ${report.confidence}`,
    `Completed: ${report.completedAt}`,
    ""
  ];

  for (const service of report.services) {
    const score = service.score;
    const primary = service.endpoints[0];
    lines.push(
      `${service.serviceId}: ${score ? `${score.score}/100 (${score.grade})` : "Not scored"}`,
      `  Primary reachable: ${service.primaryEndpointReachable ? "yes" : "no"}`,
      `  Critical coverage: ${Math.round(service.criticalEndpointCoverage * 100)}%`,
      `  Success rate: ${primary?.metrics.successRate === null || primary?.metrics.successRate === undefined ? "n/a" : `${Math.round(primary.metrics.successRate * 100)}%`}`,
      `  P95: ${primary?.metrics.latency ? `${Math.round(primary.metrics.latency.p95Ms)} ms` : "n/a"}`
    );
  }

  if (report.limitations.length > 0) {
    lines.push("", `Limitations: ${report.limitations.join(", ")}`);
  }

  return lines.join("\n");
}

export function createTextReportExport(
  report: BenchmarkReport
): BenchmarkReportExport {
  return {
    filename: `ai-network-check-${safeFilenameSegment(report.route ?? "unnamed-route")}-${timestampForFilename(report.completedAt)}.txt`,
    mimeType: "text/plain",
    content: createTextReportSummary(report)
  };
}
