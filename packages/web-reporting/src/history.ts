import {
  parseBenchmarkReport,
  serializeBenchmarkReport,
  validateBenchmarkReport,
  type BenchmarkReport
} from "../../core/src/index.ts";
import {
  DEFAULT_REPORT_HISTORY_KEY,
  DEFAULT_REPORT_HISTORY_LIMIT,
  REPORT_HISTORY_SCHEMA_VERSION,
  type ReportHistoryEnvelope,
  type ReportHistoryOptions,
  type RouteHistoryAggregate,
  type RouteServiceAggregate
} from "./types.ts";

interface ResolvedHistoryOptions {
  readonly key: string;
  readonly limit: number;
}

function resolveOptions(options: ReportHistoryOptions = {}): ResolvedHistoryOptions {
  const key = options.key?.trim() || DEFAULT_REPORT_HISTORY_KEY;
  const limit = options.limit ?? DEFAULT_REPORT_HISTORY_LIMIT;

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("history limit must be a positive integer");
  }

  return { key, limit };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completedAtDescending(
  left: BenchmarkReport,
  right: BenchmarkReport
): number {
  return Date.parse(right.completedAt) - Date.parse(left.completedAt);
}

function parseEnvelope(raw: string): readonly BenchmarkReport[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }

  if (
    !isRecord(value) ||
    value.schemaVersion !== REPORT_HISTORY_SCHEMA_VERSION ||
    !Array.isArray(value.reports)
  ) {
    return [];
  }

  const reports: BenchmarkReport[] = [];
  for (const candidate of value.reports) {
    try {
      reports.push(parseBenchmarkReport(JSON.stringify(candidate)));
    } catch {
      // Skip one damaged entry without discarding other valid history.
    }
  }
  return reports;
}

export function createReportFingerprint(report: BenchmarkReport): string {
  const services = report.services.map((service) => service.serviceId).join(",");
  return `${report.completedAt}|${report.route ?? ""}|${services}`;
}

export function readReportHistory(
  storage: Pick<Storage, "getItem">,
  options: ReportHistoryOptions = {}
): readonly BenchmarkReport[] {
  const resolved = resolveOptions(options);
  const raw = storage.getItem(resolved.key);
  if (!raw) {
    return [];
  }

  return [...parseEnvelope(raw)]
    .sort(completedAtDescending)
    .slice(0, resolved.limit);
}

function writeHistory(
  storage: Pick<Storage, "setItem">,
  key: string,
  reports: readonly BenchmarkReport[]
): void {
  const envelope: ReportHistoryEnvelope = {
    schemaVersion: REPORT_HISTORY_SCHEMA_VERSION,
    reports
  };
  storage.setItem(key, JSON.stringify(envelope));
}

export function saveReportToHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  report: BenchmarkReport,
  options: ReportHistoryOptions = {}
): readonly BenchmarkReport[] {
  const errors = validateBenchmarkReport(report);
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark report: ${errors.join("; ")}`);
  }

  const resolved = resolveOptions(options);
  const fingerprint = createReportFingerprint(report);
  const reports = [
    report,
    ...readReportHistory(storage, resolved).filter(
      (candidate) => createReportFingerprint(candidate) !== fingerprint
    )
  ]
    .sort(completedAtDescending)
    .slice(0, resolved.limit);

  writeHistory(storage, resolved.key, reports);
  return reports;
}

export function removeReportFromHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  fingerprint: string,
  options: ReportHistoryOptions = {}
): readonly BenchmarkReport[] {
  const resolved = resolveOptions(options);
  const reports = readReportHistory(storage, resolved).filter(
    (report) => createReportFingerprint(report) !== fingerprint
  );
  writeHistory(storage, resolved.key, reports);
  return reports;
}

export function clearReportHistory(
  storage: Pick<Storage, "removeItem">,
  options: ReportHistoryOptions = {}
): void {
  storage.removeItem(resolveOptions(options).key);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function aggregateRouteHistory(
  reports: readonly BenchmarkReport[]
): readonly RouteHistoryAggregate[] {
  const grouped = new Map<string, BenchmarkReport[]>();

  for (const report of reports) {
    if (!report.route) {
      continue;
    }
    const group = grouped.get(report.route) ?? [];
    group.push(report);
    grouped.set(report.route, group);
  }

  return [...grouped.entries()]
    .map(([route, routeReports]) => {
      const sorted = [...routeReports].sort(completedAtDescending);
      const serviceIds = new Set(
        sorted.flatMap((report) => report.services.map((service) => service.serviceId))
      );
      const services: RouteServiceAggregate[] = [...serviceIds]
        .sort()
        .map((serviceId) => {
          const scores = sorted
            .flatMap((report) => report.services)
            .filter((service) => service.serviceId === serviceId && service.score)
            .map((service) => service.score!.score);
          const latestService = sorted
            .flatMap((report) => report.services)
            .find((service) => service.serviceId === serviceId && service.score);

          return {
            serviceId,
            reportCount: scores.length,
            averageScore: average(scores),
            latestScore: latestService?.score?.score ?? null,
            latestGrade: latestService?.score?.grade ?? null
          };
        });

      return {
        route,
        reportCount: sorted.length,
        latestCompletedAt: sorted[0]!.completedAt,
        services
      };
    })
    .sort((left, right) =>
      Date.parse(right.latestCompletedAt) - Date.parse(left.latestCompletedAt)
    );
}

export function cloneReportForStorage(report: BenchmarkReport): BenchmarkReport {
  return parseBenchmarkReport(serializeBenchmarkReport(report));
}
