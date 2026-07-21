import type {
  EvidenceLimitation,
  EvidenceReport
} from "@ai-network-check/evidence-report";
import type { EvidenceSessionSnapshot } from "./evidence-session.ts";

const limitationLabels: Record<EvidenceLimitation, string> = {
  "browser-http-status-unverified": "浏览器跨域 HTTP 状态仍可能不可读",
  "public-websocket-only": "WebSocket 结果来自公共 echo 服务",
  "ai-internal-websocket-unverified": "AI 服务内部 WebSocket 仍未验证",
  "local-network-phases-partial": "尚未完成全部 AI 服务的本地网络阶段检测",
  "real-tool-not-run": "尚未运行真实 Codex CLI 检测"
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

function evidenceCard(
  title: string,
  description: string,
  complete: boolean,
  value: string
): string {
  return `
    <div class="evidence-card ${complete ? "complete" : "pending"}">
      <span class="evidence-card-state" aria-hidden="true">${complete ? "✓" : "○"}</span>
      <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></div>
      <span class="evidence-card-value">${escapeHtml(value)}</span>
    </div>
  `;
}

export function evidenceFilename(report: EvidenceReport): string {
  const route = (report.route ?? "session")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "session";
  const timestamp = report.createdAt.replace(/[:.]/g, "-");
  return `ai-network-evidence-${route}-${timestamp}.json`;
}

export function renderEvidencePanel(snapshot: EvidenceSessionSnapshot): string {
  const { coverage, report, hasEvidence } = snapshot;
  const localValue = coverage.expectedLocalNetworkServiceCount
    ? `${coverage.localNetworkServiceCount}/${coverage.expectedLocalNetworkServiceCount}`
    : String(coverage.localNetworkServiceCount);

  return `
    <section class="evidence-section">
      <div class="evidence-heading">
        <div>
          <span class="eyebrow">Professional Evidence Report</span>
          <h2>统一专业检测报告</h2>
          <p>把不同置信等级的证据组合在一个版本化 JSON 中；不会包含 Agent 令牌、认证数据或模型原文。</p>
        </div>
        <span class="evidence-route">${escapeHtml(report.route ?? "当前会话")}</span>
      </div>
      <div class="evidence-grid">
        ${evidenceCard("浏览器 HTTPS", "多服务连通性、延迟与稳定性", coverage.webHttps, coverage.webHttps ? "已收集" : "待检测")}
        ${evidenceCard("公共 WebSocket", "公共 echo 握手、RTT 与保持", coverage.publicWebSocket, coverage.publicWebSocket ? "已收集" : "待检测")}
        ${evidenceCard("本地网络阶段", "DNS / TCP / TLS / TTFB", coverage.localNetworkServiceCount > 0, localValue)}
        ${evidenceCard("真实 Codex", "固定安全任务的真实 CLI 结果", coverage.realCodex, coverage.realCodex ? "已收集" : "待检测")}
      </div>
      <div class="evidence-limitations">
        ${report.limitations.map((item) => `<span>${escapeHtml(limitationLabels[item])}</span>`).join("") || "<span>当前证据没有额外限制项</span>"}
      </div>
      <div class="evidence-actions">
        <button id="download-evidence-button" class="evidence-primary" type="button" ${hasEvidence ? "" : "disabled"}>下载统一证据报告</button>
        <button id="reset-evidence-button" class="evidence-secondary" type="button" ${hasEvidence ? "" : "disabled"}>清空当前会话证据</button>
      </div>
    </section>
  `;
}
