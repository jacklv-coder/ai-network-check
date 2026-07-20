import type {
  WebSocketBenchmarkProgress,
  WebSocketBenchmarkResult
} from "@ai-network-check/websocket-benchmark";

export type RealtimeUiState =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly progress: WebSocketBenchmarkProgress | null }
  | { readonly phase: "result"; readonly result: WebSocketBenchmarkResult }
  | { readonly phase: "error"; readonly message: string };

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

function formatMs(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)} ms`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function renderRealtimePanel(state: RealtimeUiState): string {
  if (state.phase === "idle") {
    return `
      <section class="realtime-section">
        <div class="realtime-copy">
          <span class="eyebrow">Public WebSocket Benchmark</span>
          <h2>测试公共长连接能力</h2>
          <p>连接 Postman 公共 WSS echo 服务 20 秒，检测握手、心跳 RTT、丢失与异常断开。</p>
        </div>
        <div class="realtime-boundary">这项结果只代表公共 WebSocket 能力，不代表 OpenAI、Claude 等内部协议已验证。</div>
        <button id="start-realtime-button" class="realtime-primary" type="button">开始 20 秒长连接测试</button>
      </section>
    `;
  }

  if (state.phase === "running") {
    const progress = state.progress;
    return `
      <section class="realtime-section realtime-running" aria-live="polite">
        <div class="realtime-pulse" aria-hidden="true"><span></span></div>
        <div class="realtime-copy centered">
          <span class="eyebrow">WebSocket Running</span>
          <h2>${progress?.type === "connecting" ? "正在建立 WSS 连接" : "正在保持长连接"}</h2>
          <p>已发送 ${progress?.sentCount ?? 0} 次，收到 ${progress?.receivedCount ?? 0} 次，丢失 ${progress?.lostCount ?? 0} 次。</p>
        </div>
        <div class="realtime-live-grid">
          <div><span>握手</span><strong>${formatMs(progress?.handshakeMs)}</strong></div>
          <div><span>当前成功率</span><strong>${formatPercent(progress?.metrics.successRate ?? null)}</strong></div>
          <div><span>当前 P95</span><strong>${formatMs(progress?.metrics.latency?.p95Ms)}</strong></div>
        </div>
        <button id="stop-realtime-button" class="realtime-secondary" type="button">停止长连接测试</button>
      </section>
    `;
  }

  if (state.phase === "error") {
    return `
      <section class="realtime-section realtime-error" aria-live="assertive">
        <div class="realtime-copy">
          <span class="eyebrow">WebSocket Error</span>
          <h2>公共长连接测试失败</h2>
          <p>${escapeHtml(state.message)}</p>
        </div>
        <button id="start-realtime-button" class="realtime-primary" type="button">重新测试</button>
      </section>
    `;
  }

  const { result } = state;
  const latency = result.metrics.latency;
  const statusLabel =
    result.status === "completed"
      ? "连接保持完成"
      : result.status === "handshake-timeout"
        ? "握手超时"
        : result.status === "closed-early"
          ? "连接提前断开"
          : "连接错误";

  return `
    <section class="realtime-section realtime-result" aria-live="polite">
      <div class="realtime-result-head">
        <div class="realtime-copy">
          <span class="eyebrow">Public WebSocket Result</span>
          <h2>${statusLabel}</h2>
          <p>公共 WSS echo 测试已完成；AI 服务内部 WebSocket 与真实流式输出仍未验证。</p>
        </div>
        <span class="realtime-status status-${result.status}">${result.status === "completed" ? "PASS" : "CHECK"}</span>
      </div>
      <div class="realtime-metrics">
        <div><span>握手耗时</span><strong>${formatMs(result.handshakeMs)}</strong></div>
        <div><span>心跳成功率</span><strong>${formatPercent(result.metrics.successRate)}</strong></div>
        <div><span>平均 RTT</span><strong>${formatMs(latency?.averageMs)}</strong></div>
        <div><span>P95 RTT</span><strong>${formatMs(latency?.p95Ms)}</strong></div>
        <div><span>抖动</span><strong>${formatMs(latency?.jitterMs)}</strong></div>
        <div><span>丢失</span><strong>${result.lostCount} / ${result.sentCount}</strong></div>
      </div>
      ${result.close ? `<div class="realtime-close">关闭代码 ${result.close.code}${result.close.reason ? ` · ${escapeHtml(result.close.reason)}` : ""}</div>` : ""}
      <button id="start-realtime-button" class="realtime-primary" type="button">重新测试公共长连接</button>
    </section>
  `;
}
