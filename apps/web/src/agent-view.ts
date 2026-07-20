import type {
  AgentStatusResponse,
  CodexBenchmarkApiResponse
} from "./agent-client.ts";

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
      readonly phase: "error";
      readonly message: string;
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

export function renderAgentPanel(state: AgentUiState): string {
  if (state.phase === "disconnected") {
    return `
      <section class="agent-section">
        <div class="agent-copy">
          <span class="eyebrow">Local Real Tool Benchmark</span>
          <h2>运行真实 Codex CLI 检测</h2>
          <p>启动本地 Agent 后，网页可以运行固定且无文件访问的 Codex 请求，并测量首事件、首次回复和总耗时。</p>
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
      </section>
    `;
  }

  if (state.phase === "error") {
    return `
      <section class="agent-section" aria-live="assertive">
        ${statusSummary(status)}
        <div class="agent-result-head"><div><span class="eyebrow">Real Codex Error</span><h2>真实检测未完成</h2><p>${escapeHtml(state.message)}</p></div></div>
        <button id="agent-run-button" class="agent-primary" type="button">重新运行</button>
      </section>
    `;
  }

  return `
    <section class="agent-section">
      ${statusSummary(status)}
      <div class="agent-copy"><span class="eyebrow">Local Agent Ready</span><h2>本地 Agent 已准备好</h2><p>Codex CLI 能力端点已启用；实际安装和登录状态会在运行时检测。</p></div>
      <button id="agent-run-button" class="agent-primary" type="button">运行真实 Codex 检测</button>
    </section>
  `;
}
