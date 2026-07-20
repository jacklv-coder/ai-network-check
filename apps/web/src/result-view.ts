import type {
  AIServiceDefinition,
  BenchmarkReport,
  BenchmarkSample,
  EndpointBenchmarkReport,
  ReportLimitation,
  ScoreCapId,
  ScoreGrade,
  UnverifiedDimensionId
} from "@ai-network-check/core";

export interface EndpointResultViewModel {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly successRate: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly status: "good" | "warning" | "bad" | "unknown";
  readonly httpStatusVerified: boolean;
}

export interface ServiceResultViewModel {
  readonly id: string;
  readonly name: string;
  readonly score: number | null;
  readonly grade: ScoreGrade | null;
  readonly primary: EndpointResultViewModel | null;
  readonly endpoints: readonly EndpointResultViewModel[];
  readonly caps: readonly ScoreCapId[];
  readonly unverified: readonly UnverifiedDimensionId[];
  readonly sparklinePoints: string;
}

const gradeLabels: Record<ScoreGrade, string> = {
  excellent: "优秀",
  good: "良好",
  fair: "一般",
  poor: "较差",
  critical: "严重"
};

const limitationLabels: Record<ReportLimitation, string> = {
  "http-status-unverified": "浏览器无法读取部分跨域 HTTP 状态",
  "network-phases-unverified": "未拆分 DNS、TCP、TLS 与 TTFB",
  "websocket-unverified": "未验证 AI 服务内部 WebSocket",
  "real-tool-unverified": "未运行真实 Codex / Claude Code 请求"
};

const unverifiedLabels: Record<UnverifiedDimensionId, string> = {
  realtime: "Realtime 未验证",
  "real-tool": "真实工具未验证"
};

const capLabels: Record<ScoreCapId, string> = {
  "request-failure": "存在失败请求，评分最高 79",
  "success-below-95": "成功率低于 95%，评分最高 59",
  "success-below-85": "成功率低于 85%，评分最高 39",
  "primary-unreachable": "主端点不可访问，评分最高 20"
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character] ?? character
  );
}

function endpointStatus(endpoint: EndpointBenchmarkReport): EndpointResultViewModel["status"] {
  const successRate = endpoint.metrics.successRate;
  if (successRate === null) return "unknown";
  if (successRate === 1) return "good";
  if (successRate >= 0.95) return "warning";
  return "bad";
}

function endpointViewModel(
  endpoint: EndpointBenchmarkReport,
  definition: AIServiceDefinition | undefined
): EndpointResultViewModel {
  const endpointDefinition = definition?.endpoints.find(
    (candidate) => candidate.id === endpoint.endpointId
  );
  return {
    id: endpoint.endpointId,
    label: endpointDefinition?.label ?? endpoint.endpointId,
    role: endpointDefinition?.role ?? "unknown",
    successRate: endpoint.metrics.successRate,
    p50Ms: endpoint.metrics.latency?.p50Ms ?? null,
    p95Ms: endpoint.metrics.latency?.p95Ms ?? null,
    status: endpointStatus(endpoint),
    httpStatusVerified: endpoint.httpStatusVerification === "verified"
  };
}

export function createSparklinePoints(
  samples: readonly BenchmarkSample[],
  width = 260,
  height = 72,
  padding = 6
): string {
  const durations = samples
    .filter((sample) => sample.status === "success")
    .map((sample) => sample.durationMs);

  if (durations.length === 0) return "";

  const minimum = Math.min(...durations);
  const maximum = Math.max(...durations);
  const range = Math.max(1, maximum - minimum);
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  return durations
    .map((duration, index) => {
      const x =
        durations.length === 1
          ? width / 2
          : padding + (usableWidth * index) / (durations.length - 1);
      const y = padding + usableHeight - ((duration - minimum) / range) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function buildServiceResultViewModels(
  report: BenchmarkReport,
  definitions: readonly AIServiceDefinition[]
): readonly ServiceResultViewModel[] {
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));

  return report.services.map((service): ServiceResultViewModel => {
    const definition = definitionById.get(service.serviceId);
    const endpoints = service.endpoints.map((endpoint) =>
      endpointViewModel(endpoint, definition)
    );
    const primaryDefinition = definition?.endpoints.find(
      (endpoint) => endpoint.role === "primary"
    );
    const primaryIndex = service.endpoints.findIndex(
      (endpoint) => endpoint.endpointId === primaryDefinition?.id
    );
    const primaryReport = primaryIndex >= 0 ? service.endpoints[primaryIndex] : null;

    return {
      id: service.serviceId,
      name: definition?.displayName ?? service.serviceId,
      score: service.score?.score ?? null,
      grade: service.score?.grade ?? null,
      primary: primaryIndex >= 0 ? endpoints[primaryIndex] ?? null : null,
      endpoints,
      caps: service.score?.capsApplied.map((cap) => cap.id) ?? [],
      unverified: service.score?.unverifiedDimensions ?? [],
      sparklinePoints: primaryReport ? createSparklinePoints(primaryReport.samples) : ""
    };
  });
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatMilliseconds(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function renderEndpoint(endpoint: EndpointResultViewModel): string {
  return `
    <div class="endpoint-row">
      <span class="endpoint-state ${endpoint.status}" aria-hidden="true"></span>
      <div><strong>${escapeHtml(endpoint.label)}</strong><small>${escapeHtml(endpoint.role)}</small></div>
      <span>${formatPercent(endpoint.successRate)}</span>
      <span>${formatMilliseconds(endpoint.p50Ms)}</span>
      <span>${endpoint.httpStatusVerified ? "状态已验证" : "状态未验证"}</span>
    </div>
  `;
}

function renderServiceCard(service: ServiceResultViewModel): string {
  const primary = service.primary;
  const grade = service.grade ? gradeLabels[service.grade] : "未评分";
  const warnings = [
    ...service.caps.map((cap) => capLabels[cap]),
    ...service.unverified.map((item) => unverifiedLabels[item])
  ];
  return `
    <article class="service-result-card">
      <header class="service-result-head">
        <div><span class="service-result-name">${escapeHtml(service.name)}</span><small>HTTPS Network Score</small></div>
        <div class="service-score grade-${service.grade ?? "unknown"}"><strong>${service.score ?? "—"}</strong><span>${grade}</span></div>
      </header>
      <div class="primary-metrics">
        <div><span>成功率</span><strong>${formatPercent(primary?.successRate ?? null)}</strong></div>
        <div><span>P50</span><strong>${formatMilliseconds(primary?.p50Ms ?? null)}</strong></div>
        <div><span>P95</span><strong>${formatMilliseconds(primary?.p95Ms ?? null)}</strong></div>
      </div>
      <div class="sparkline-wrap">
        ${service.sparklinePoints ? `<svg viewBox="0 0 260 72" role="img" aria-label="主端点延迟趋势"><polyline points="${service.sparklinePoints}" /></svg>` : `<span>没有可绘制的成功样本</span>`}
      </div>
      <div class="endpoint-table">
        <div class="endpoint-row endpoint-header"><span></span><span>端点</span><span>成功率</span><span>P50</span><span>HTTP</span></div>
        ${service.endpoints.map(renderEndpoint).join("")}
      </div>
      ${warnings.length ? `<div class="service-warnings">${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    </article>
  `;
}

export function renderResultDetails(
  report: BenchmarkReport,
  definitions: readonly AIServiceDefinition[]
): string {
  const services = buildServiceResultViewModels(report, definitions);
  const limitations = report.limitations.map((limitation) => limitationLabels[limitation]);
  return `
    <div class="result-details">
      <div class="result-section-head"><div><span class="state-kicker">Service Results</span><h3>各 AI 服务检测结果</h3></div><span>${services.length} 个服务</span></div>
      <div class="service-results-grid">${services.map(renderServiceCard).join("")}</div>
      <section class="verification-card">
        <div><span class="state-kicker">Verification Boundary</span><h3>这份结果验证了什么？</h3></div>
        <div class="verification-list">${limitations.map((limitation) => `<span>${escapeHtml(limitation)}</span>`).join("")}</div>
      </section>
    </div>
  `;
}
