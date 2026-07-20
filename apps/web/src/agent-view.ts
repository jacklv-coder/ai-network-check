import type {
  AgentStatusResponse,
  CodexBenchmarkApiResponse,
  NetworkPhaseEndpointApiResult,
  NetworkPhaseServiceApiResponse
} from "./agent-client.ts";

export interface AgentServiceOption {
  readonly id: string;
  readonly label: string;
}

export type AgentUiState =
  | { readonly phase: "disconnected" }
  | { readonly phase: "connecting" }
  | { readonly phase: "connected"; readonly status: AgentStatusResponse }
  | { readonly phase: "running"; readonly status: AgentStatusResponse }
  | {
      readonly phase: "result";
      readonly status: AgentStatusResponse;
      readonly benchmark: CodexBenchmarkApiResponse;
    }
  | {
      readonly phase: "network-running";
      readonly status: AgentStatusResponse;
      readonly serviceId: string;
      readonly serviceName: string;
    }
  | {
      readonly phase: "network-result";
      readonly status: AgentStatusResponse;
      readonly benchmark: NetworkPhaseServiceApiResponse;
    }
  | {
      readonly phase: "error";
      readonly message: string;
      readonly operation?: "codex" | "network";
      readonly serviceId?: string;
      readonly status?: AgentStatusResponse;
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

function formatMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

const resultLabels = {
  success: ["真实 Codex 请求成功", "success"],
  "not-installed": ["未检测到 Codex CLI", "warning"],
  "not-authenticated": ["Codex CLI 尚未登录", "warning"],
  timeout: ["真实请求超时", "bad"],
  cancelled: ["检测已取消", "neutral"],
  "output-limit": ["输出超过安全上限", "bad"],
  failed: ["真实请求失败", "bad"]
} as const;

const phaseStatusLabels = {
  success: "成功",
  "dns-error": "DNS 错误",
  "tcp-error": "TCP 错误",
  "tls-error": "TLS 错误",
  timeout: "超时",
  cancelled: "已取消",
  "request-error": "请求错误"
} as const;

function connectionForm(message = ""): string {
  return `
    <form id="agent-connect-form" class="agent-connect-form" novalidate>
      <div class="agent-fields">
        <label><span>Agent 端口</span><input id="agent-port" type="number" min="1" max="65535" value="3210" inputmode="numeric" /></label>
        <label class="agent-token-field"><span>会话令牌</span><input id="agent-token" type="password" minlength="32" autocomplete="off" spellcheck="false" placeholder="粘贴本地 Agent 输出的 Session token" /></label>
      </div>
      ${message ? `<div class="agent-error">${escapeHtml(message)}</div>` : ""}
      <button class="agent-primary" type="submit">连接本地 Agent</button>
      <p class="agent-privacy">令牌只保存在当前页面内存，不写入浏览器存储或检测报告。</p>
    </form>
  `;
}

function statusSummary(status: AgentStatusResponse): string {
  return `
    <div class="agent-status-row">
      <span class="agent-online-dot"></span>
      <div><strong>本地 Agent 已连接</strong><small>127.0.0.1:${status.port} · API v${status.version}</small></div>
      <button id="agent-disconnect-button" type="button">断开</button>
    </div>
  `;
}

function renderServiceOptions(services: readonly AgentServiceOption[]): string {
  return services
    .map(
      (service) =>
        `<option value="${escapeHtml(service.id)}">${escapeHtml(service.label)}</option>`
    )
    .join("");
}

function renderReadyTools(
  status: AgentStatusResponse,
  services: readonly AgentServiceOption[]
): string {
  return `
    <div class="agent-tools-grid">
      <section class="agent-tool-card">
        <span class="eyebrow">Real Codex</span>
        <h3>真实 Codex CLI</h3>
        <p>运行固定的“只回复 OK”任务，测量首事件、首次回复与总耗时。</p>
        <button id="agent-run-button" class="agent-primary" type="button" ${status.capabilities.codexCli ? "" : "disabled"}>运行真实 Codex 检测</button>
      </section>
      <section class="agent-tool-card">
        <span class="eyebrow">Network Phases</span>
        <h3>DNS / TCP / TLS / TTFB</h3>
        <p>只检测内置服务目录中的 HTTPS 端点，不接受网页提交任意 URL。</p>
        <label class="agent-service-select"><span>AI 服务</span><select id="agent-network-service">${renderServiceOptions(services)}</select></label>
        <button id="agent-network-run-button" class="agent-primary" type="button" ${status.capabilities.networkPhases && services.length ? "" : "disabled"}>运行本地网络阶段检测</button>
      </section>
    </div>
  `;
}

function renderNetworkEndpoint(endpoint: NetworkPhaseEndpointApiResult): string {
  const phases = endpoint.result.phases;
  return `
    <article class="agent-phase-endpoint tone-${endpoint.result.status === "success" ? "success" : "bad"}">
      <header>
        <div><strong>${escapeHtml(endpoint.label)}</strong><small>${escapeHtml(endpoint.role)}${endpoint.critical ? " · 关键端点" : ""}</small></div>
        <span>${phaseStatusLabels[endpoint.result.status]}</span>
      </header>
      <div class="agent-phase-grid">
        <div><span>DNS</span><strong>${formatMs(phases?.dnsMs ?? null)}</strong></div>
        <div><span>TCP</span><strong>${formatMs(phases?.tcpMs ?? null)}</strong></div>
        <div><span>TLS</span><strong>${formatMs(phases?.tlsMs ?? null)}</strong></div>
        <div><span>请求→首字节</span><strong>${formatMs(phases?.requestToFirstByteMs ?? null)}</strong></div>
        <div><span>总首字节</span><strong>${formatMs(phases?.totalToFirstByteMs ?? null)}</strong></div>
      </div>
      <footer>
        <span>${escapeHtml(endpoint.result.hostname)}</span>
        <span>${escapeHtml(endpoint.result.resolvedAddress ?? "未解析")}${endpoint.result.httpStatus === null ? "" : ` · HTTP ${endpoint.result.httpStatus}`}</span>
      </footer>
    </article>
  `;
}

export function renderAgentPanel(
  state: AgentUiState,
  services: readonly AgentServiceOption[] = []
): string {
  if (state.phase === "disconnected") {
    return `
      <section class="agent-section">
        <div class="agent-copy">
          <span class="eyebrow">Local Professional Benchmark</span>
          <h2>连接本地专业检测</h2>
          <p>启动 Local Agent 后，可运行真实 Codex 请求以及 DNS、TCP、TLS、TTFB 分阶段检测。</p>
        </div>
        <div class="agent-command"><code>npm run start:agent</code><span>在项目目录启动</span></div>
        ${connectionForm()}
      </section>
    `;
  }

  if (state.phase === "connecting") {
    return `
      <section class="agent-section agent-centered" aria-live="polite">
        <div class="agent-spinner" aria-hidden="true"></div>
        <span class="eyebrow">Connecting</span>
        <h2>正在连接本地 Agent</h2>
        <p>浏览器可能会请求 loopback 网络访问权限。</p>
      </section>
    `;
  }

  if (state.phase === "error" && !state.status) {
    return `
      <section class="agent-section">
        <div class="agent-copy">
          <span class="eyebrow">Agent Connection</span>
          <h2>无法连接本地 Agent</h2>
          <p>确认 Agent 已启动、端口正确，并使用终端显示的最新会话令牌。</p>
        </div>
        ${connectionForm(state.message)}
      </section>
    `;
  }

  const status = state.status;
  if (!status) return "";

  if (state.phase === "running") {
    return `
      <section class="agent-section agent-centered" aria-live="polite">
        ${statusSummary(status)}
        <div class="agent-spinner agent-spinner-large" aria-hidden="true"></div>
        <span class="eyebrow">Real Codex Running</span>
        <h2>正在运行固定 Codex 请求</h2>
        <p>任务只要求回复 OK，不读取项目文件，也不接收网页自定义参数。</p>
        <button id="agent-stop-button" class="agent-secondary" type="button">停止真实检测</button>
      </section>
    `;
  }

  if (state.phase === "network-running") {
    return `
      <section class="agent-section agent-centered" aria-live="polite">
        ${statusSummary(status)}
        <div class="agent-spinner agent-spinner-large" aria-hidden="true"></div>
        <span class="eyebrow">Network Phases Running</span>
        <h2>正在检测 ${escapeHtml(state.serviceName)}</h2>
        <p>依次建立全新 HTTPS 连接并测量 DNS、TCP、TLS 与首字节。</p>
        <button id="agent-network-stop-button" class="agent-secondary" type="button">停止网络阶段检测</button>
      </section>
    `;
  }

  if (state.phase === "result") {
    const result = state.benchmark.result;
    const [label, tone] = resultLabels[result.status];
    return `
      <section class="agent-section" aria-live="polite">
        ${statusSummary(status)}
        <div class="agent-result-head">
          <div><span class="eyebrow">Real Codex Result</span><h2>${label}</h2><p>Prompt ID：${escapeHtml(state.benchmark.promptId)}。模型原文和认证信息不会返回网页。</p></div>
          <span class="agent-result-badge tone-${tone}">${escapeHtml(result.status)}</span>
        </div>
        <div class="agent-metrics">
          <div><span>Codex 版本</span><strong>${escapeHtml(result.inspection.version ?? "—")}</strong></div>
          <div><span>首个事件</span><strong>${formatMs(result.firstEventMs)}</strong></div>
          <div><span>首次 Agent 回复</span><strong>${formatMs(result.firstAgentMessageMs)}</strong></div>
          <div><span>总耗时</span><strong>${formatMs(result.durationMs)}</strong></div>
          <div><span>退出码</span><strong>${result.exitCode ?? "—"}</strong></div>
          <div><span>完整完成事件</span><strong>${result.sawTurnCompleted ? "是" : "否"}</strong></div>
        </div>
        <button id="agent-run-button" class="agent-primary" type="button">再次运行真实 Codex 检测</button>
        ${renderReadyTools(status, services)}
      </section>
    `;
  }

  if (state.phase === "network-result") {
    return `
      <section class="agent-section" aria-live="polite">
        ${statusSummary(status)}
        <div class="agent-result-head">
          <div><span class="eyebrow">Local Network Phase Result</span><h2>${escapeHtml(state.benchmark.displayName)}</h2><p>结果来自 Agent 内置服务目录，网页没有提交任意 URL。</p></div>
          <span class="agent-result-badge tone-${state.benchmark.cancelled ? "neutral" : "success"}">${state.benchmark.cancelled ? "cancelled" : "complete"}</span>
        </div>
        <div class="agent-phase-list">${state.benchmark.endpoints.map(renderNetworkEndpoint).join("")}</div>
        ${renderReadyTools(status, services)}
      </section>
    `;
  }

  if (state.phase === "error") {
    return `
      <section class="agent-section" aria-live="assertive">
        ${statusSummary(status)}
        <div class="agent-result-head"><div><span class="eyebrow">Local Agent Error</span><h2>本地检测未完成</h2><p>${escapeHtml(state.message)}</p></div></div>
        ${renderReadyTools(status, services)}
      </section>
    `;
  }

  return `
    <section class="agent-section">
      ${statusSummary(status)}
      <div class="agent-copy"><span class="eyebrow">Local Agent Ready</span><h2>本地专业检测已准备好</h2><p>选择真实 Codex 或网络阶段检测；两种任务不会同时运行。</p></div>
      ${renderReadyTools(status, services)}
    </section>
  `;
}
