import "./styles.css";
import "./result-details.css";

import { listServices } from "@ai-network-check/core";
import {
  runWebBenchmarkWorkflow,
  WebBenchmarkWorkflowCancelledError,
  type WebBenchmarkWorkflowProgress
} from "@ai-network-check/web-workflow";

import {
  averageServiceScore,
  createInitialWebAppState,
  reduceWebAppState,
  type WebAppAction,
  type WebAppState
} from "./state.ts";
import { renderResultDetails } from "./result-view.ts";

const appRoot = document.querySelector("#app");

if (!(appRoot instanceof HTMLElement)) {
  throw new Error("Missing #app root element");
}

const root: HTMLElement = appRoot;
const services = listServices();
const serviceById = new Map(services.map((service) => [service.id, service]));
const endpointLabels = new Map(
  services.flatMap((service) =>
    service.endpoints.map((endpoint) => [endpoint.id, endpoint.label] as const)
  )
);

let state = createInitialWebAppState({
  selectedServiceIds: services.map((service) => service.id)
});
let activeController: AbortController | null = null;

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

function dispatch(action: WebAppAction): void {
  state = reduceWebAppState(state, action);
  render();
}

function renderServiceOptions(currentState: WebAppState): string {
  return services
    .map((service) => {
      const checked = currentState.configuration.selectedServiceIds.includes(service.id)
        ? "checked"
        : "";
      return `
        <label class="service-option">
          <input type="checkbox" name="service" value="${escapeHtml(service.id)}" ${checked} />
          <span class="service-check"></span>
          <span>
            <strong>${escapeHtml(service.displayName)}</strong>
            <small>${service.endpoints.length} 个 HTTPS 端点</small>
          </span>
        </label>
      `;
    })
    .join("");
}

function renderIdle(currentState: WebAppState): string {
  return `
    <form id="benchmark-form" class="state-panel" novalidate>
      <div class="panel-heading">
        <span class="state-kicker">Ready</span>
        <h2>检测当前网络是否适合 AI 服务</h2>
        <p>浏览器会从当前设备发起 HTTPS 请求，因此结果会经过你正在使用的代理路线。</p>
      </div>

      <label class="field">
        <span>路线名称 <em>可选</em></span>
        <input id="route-input" type="text" maxlength="60" placeholder="例如：VMISS 洛杉矶 01" value="${escapeHtml(currentState.configuration.route)}" />
      </label>

      <fieldset class="service-fieldset">
        <legend>检测服务</legend>
        <div class="service-grid">${renderServiceOptions(currentState)}</div>
      </fieldset>

      <label class="field compact-field">
        <span>主端点采样次数</span>
        <select id="sample-count">
          ${[10, 20, 30]
            .map(
              (count) =>
                `<option value="${count}" ${count === currentState.configuration.primarySampleCount ? "selected" : ""}>${count} 次${count === 20 ? "（推荐）" : ""}</option>`
            )
            .join("")}
        </select>
      </label>

      <button class="primary-button" type="submit">
        <span>开始检测</span>
        <span aria-hidden="true">→</span>
      </button>
      <p class="privacy-note">无需 API Key。在线版只验证 HTTPS 网络质量，不读取 AI 账号。</p>
    </form>
  `;
}

function renderRunning(currentState: WebAppState): string {
  const progress = currentState.progress;
  const ratio = Math.round((progress?.ratio ?? 0) * 100);
  return `
    <section class="state-panel running-panel" aria-live="polite">
      <div class="radar" aria-hidden="true"><span></span></div>
      <div class="panel-heading centered">
        <span class="state-kicker running-kicker">Checking</span>
        <h2>正在检测 AI 网络</h2>
        <p>${escapeHtml(progress?.label ?? "准备检测")}</p>
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}">
        <span style="width: ${ratio}%"></span>
      </div>
      <div class="progress-meta">
        <strong>${progress?.completed ?? 0} / ${progress?.total ?? 1}</strong>
        <span>${ratio}%</span>
      </div>
      <button id="stop-button" class="secondary-button" type="button">停止检测</button>
    </section>
  `;
}

function renderResult(currentState: WebAppState): string {
  const report = currentState.report;
  if (!report) return "";

  const score = averageServiceScore(report);
  const route = report.route ?? "未命名路线";
  return `
    <section class="state-panel result-panel" aria-live="polite">
      <div class="result-summary">
        <div class="score-orb"><strong>${score ?? "—"}</strong><span>/ 100</span></div>
        <div class="panel-heading">
          <span class="state-kicker">Complete</span>
          <h2>HTTPS 基础检测完成</h2>
          <p>已完成 ${report.services.length} 个 AI 服务的浏览器基础检测。</p>
          <div class="result-facts">
            <div><span>路线</span><strong>${escapeHtml(route)}</strong></div>
            <div><span>置信等级</span><strong>Browser Basic</strong></div>
          </div>
        </div>
      </div>
      ${renderResultDetails(report, services)}
      <button id="reset-button" class="primary-button result-reset" type="button">重新检测</button>
    </section>
  `;
}

function renderError(currentState: WebAppState): string {
  return `
    <section class="state-panel error-panel" aria-live="assertive">
      <div class="error-icon" aria-hidden="true">!</div>
      <div class="panel-heading centered">
        <span class="state-kicker error-kicker">Error</span>
        <h2>检测未完成</h2>
        <p>${escapeHtml(currentState.errorMessage ?? "发生未知错误")}</p>
      </div>
      <button id="reset-button" class="primary-button" type="button">返回重试</button>
    </section>
  `;
}

function stateContent(currentState: WebAppState): string {
  switch (currentState.phase) {
    case "idle":
      return renderIdle(currentState);
    case "running":
      return renderRunning(currentState);
    case "result":
      return renderResult(currentState);
    case "error":
      return renderError(currentState);
  }
}

function render(): void {
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <a class="brand" href="./" aria-label="AI Network Check 首页">
          <span class="brand-mark" aria-hidden="true">AI</span>
          <span><strong>AI Network Check</strong><small>The network benchmark for AI developers</small></span>
        </a>
        <a class="repo-link" href="https://github.com/jacklv-coder/ai-network-check" target="_blank" rel="noreferrer">GitHub ↗</a>
      </header>

      <section class="hero-copy">
        <span class="eyebrow">Browser HTTPS Benchmark</span>
        <h1>你的网络，<br />准备好连接 AI 了吗？</h1>
        <p>比较代理路线访问 OpenAI、Claude、Gemini、Qwen 与 DeepSeek 时的基础连通性、延迟和稳定性。</p>
      </section>

      <section class="app-card">${stateContent(state)}</section>

      <footer>
        <span>AI Network Check</span>
        <span>当前版本仅生成 AI HTTPS Network Score</span>
      </footer>
    </main>
  `;

  bindEvents();
}

function selectedServiceIds(): string[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>('input[name="service"]:checked')
  ).map((input) => input.value);
}

function labelForProgress(event: WebBenchmarkWorkflowProgress): string {
  if (event.type === "service-start") {
    return `准备检测 ${serviceById.get(event.serviceId)?.displayName ?? event.serviceId}`;
  }
  if (event.type === "endpoint-start") {
    const service = serviceById.get(event.serviceId)?.displayName ?? event.serviceId;
    const endpoint = endpointLabels.get(event.endpointId) ?? event.endpointId;
    return `${service} · ${endpoint}`;
  }
  if (event.type === "endpoint-progress") {
    const endpoint = endpointLabels.get(event.progress.endpointId) ?? event.progress.endpointId;
    return `正在采样 ${endpoint}`;
  }
  if (event.type === "service-complete") {
    return `${serviceById.get(event.service.serviceId)?.displayName ?? event.service.serviceId} 已完成`;
  }
  return event.type === "workflow-complete" ? "全部服务已完成" : "准备检测";
}

function handleProgress(event: WebBenchmarkWorkflowProgress): void {
  if (event.type === "endpoint-start") {
    dispatch({
      type: "progress",
      label: labelForProgress(event),
      completed: 0,
      total: event.sampleCount
    });
    return;
  }
  if (event.type === "endpoint-progress") {
    dispatch({
      type: "progress",
      label: labelForProgress(event),
      completed: event.progress.completedSamples,
      total: event.progress.totalSamples
    });
    return;
  }
  if (event.type === "service-start" || event.type === "service-complete") {
    dispatch({ type: "progress", label: labelForProgress(event), completed: 0, total: 1 });
  }
}

async function startBenchmark(): Promise<void> {
  const routeInput = root.querySelector<HTMLInputElement>("#route-input");
  const sampleSelect = root.querySelector<HTMLSelectElement>("#sample-count");
  const serviceIds = selectedServiceIds();

  if (serviceIds.length === 0) {
    dispatch({ type: "fail", message: "请至少选择一个 AI 服务。" });
    return;
  }

  const configuration = {
    route: routeInput?.value.trim() ?? "",
    selectedServiceIds: serviceIds,
    primarySampleCount: Number(sampleSelect?.value ?? 20)
  };
  dispatch({ type: "configure", configuration });
  dispatch({ type: "start" });

  activeController = new AbortController();

  try {
    const report = await runWebBenchmarkWorkflow({
      serviceIds: configuration.selectedServiceIds,
      route: configuration.route,
      primarySampleCount: configuration.primarySampleCount,
      supportingSampleCount: 3,
      timeoutMs: 7_000,
      delayMs: 180,
      signal: activeController.signal,
      onProgress: handleProgress
    });
    dispatch({ type: "complete", report });
  } catch (error) {
    if (
      activeController.signal.aborted ||
      error instanceof WebBenchmarkWorkflowCancelledError
    ) {
      dispatch({ type: "reset" });
    } else {
      dispatch({
        type: "fail",
        message: error instanceof Error ? error.message : "检测失败，请稍后重试。"
      });
    }
  } finally {
    activeController = null;
  }
}

function bindEvents(): void {
  root.querySelector<HTMLFormElement>("#benchmark-form")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void startBenchmark();
    }
  );
  root.querySelector<HTMLButtonElement>("#stop-button")?.addEventListener(
    "click",
    () => activeController?.abort()
  );
  root.querySelector<HTMLButtonElement>("#reset-button")?.addEventListener(
    "click",
    () => dispatch({ type: "reset" })
  );
}

render();
