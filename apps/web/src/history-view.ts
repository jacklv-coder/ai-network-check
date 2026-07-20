import type { AIServiceDefinition } from "@ai-network-check/core";
import type { RouteHistoryAggregate } from "@ai-network-check/web-reporting";

const gradeLabels = {
  excellent: "优秀",
  good: "良好",
  fair: "一般",
  poor: "较差",
  critical: "严重"
} as const;

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

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function renderRouteHistory(
  routes: readonly RouteHistoryAggregate[],
  definitions: readonly AIServiceDefinition[]
): string {
  const names = new Map(
    definitions.map((definition) => [definition.id, definition.displayName])
  );

  if (routes.length === 0) {
    return `
      <section class="history-section">
        <div class="history-heading"><div><span class="eyebrow">Route History</span><h2>路线历史对比</h2></div></div>
        <div class="history-empty">还没有已命名路线的检测记录。填写路线名称后完成检测，即可在这里比较。</div>
      </section>
    `;
  }

  return `
    <section class="history-section">
      <div class="history-heading">
        <div><span class="eyebrow">Route History</span><h2>路线历史对比</h2><p>最近的路线与各 AI 服务评分都保存在当前浏览器。</p></div>
        <button id="clear-history-button" class="history-clear" type="button">清空历史</button>
      </div>
      <div class="route-grid">
        ${routes
          .map(
            (route) => `
              <article class="route-card">
                <header><div><strong>${escapeHtml(route.route)}</strong><span>${route.reportCount} 次检测</span></div><time>${escapeHtml(formatDate(route.latestCompletedAt))}</time></header>
                <div class="route-services">
                  ${route.services
                    .map(
                      (service) => `
                        <div class="route-service">
                          <span>${escapeHtml(names.get(service.serviceId) ?? service.serviceId)}</span>
                          <strong>${service.latestScore ?? "—"}</strong>
                          <small>均值 ${service.averageScore ?? "—"} · ${service.latestGrade ? gradeLabels[service.latestGrade] : "未评分"}</small>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}
