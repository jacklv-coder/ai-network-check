import "./agent.css";

import {
  AgentApiError,
  cancelAgentCodexBenchmark,
  connectAgent,
  runAgentCodexBenchmark,
  type AgentConnection,
  type AgentStatusResponse
} from "./agent-client.ts";
import { renderAgentPanel, type AgentUiState } from "./agent-view.ts";

const appRootElement = document.querySelector("#app");

if (!(appRootElement instanceof HTMLElement)) {
  throw new Error("Missing #app root element");
}

const appRoot: HTMLElement = appRootElement;
let state: AgentUiState = { phase: "disconnected" };
let connection: AgentConnection | null = null;
let requestController: AbortController | null = null;
let mountScheduled = false;

function setState(nextState: AgentUiState): void {
  state = nextState;
  renderPanel();
}

function createMount(): HTMLElement | null {
  const realtimeMount = document.querySelector<HTMLElement>("#realtime-mount");
  const appCard = appRoot.querySelector<HTMLElement>(".app-card");
  const anchor = realtimeMount ?? appCard;
  if (!anchor) return null;

  const mount = document.createElement("div");
  mount.id = "agent-mount";
  anchor.insertAdjacentElement("afterend", mount);
  return mount;
}

function renderPanel(): void {
  const httpsIsRunning = Boolean(appRoot.querySelector(".running-panel"));
  let mount = document.querySelector<HTMLElement>("#agent-mount");

  if (httpsIsRunning) {
    requestController?.abort();
    mount?.remove();
    return;
  }

  mount ??= createMount();
  if (!mount) return;

  mount.innerHTML = renderAgentPanel(state);
  bindPanelEvents(mount);
}

function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  queueMicrotask(() => {
    mountScheduled = false;
    if (!document.querySelector("#agent-mount")) renderPanel();
  });
}

function describeAgentError(error: unknown): string {
  if (error instanceof AgentApiError) {
    const messages: Record<string, string> = {
      "agent-unreachable":
        "无法访问 127.0.0.1。确认 Agent 已启动，并允许浏览器访问 loopback 网络。",
      unauthorized: "会话令牌无效或 Agent 已重新启动，请粘贴最新令牌。",
      "origin-not-allowed": "当前网页来源未被本地 Agent 允许。",
      "benchmark-already-running": "本地 Agent 已有一个 Codex 检测正在运行。",
      "request-cancelled": "请求已取消。"
    };
    return messages[error.code] ?? `Agent 请求失败：${error.code}`;
  }
  return error instanceof Error ? error.message : "本地 Agent 请求失败";
}

async function connectFromForm(mount: HTMLElement): Promise<void> {
  const port = Number(
    mount.querySelector<HTMLInputElement>("#agent-port")?.value ?? 3210
  );
  const token =
    mount.querySelector<HTMLInputElement>("#agent-token")?.value.trim() ?? "";
  const nextConnection = { port, token };
  setState({ phase: "connecting" });

  try {
    const status = await connectAgent(nextConnection);
    connection = nextConnection;
    setState({ phase: "connected", status });
  } catch (error) {
    connection = null;
    setState({ phase: "error", message: describeAgentError(error) });
  }
}

async function runCodex(status: AgentStatusResponse): Promise<void> {
  if (!connection) return;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  setState({ phase: "running", status });

  try {
    const benchmark = await runAgentCodexBenchmark(
      connection,
      controller.signal
    );
    if (!controller.signal.aborted) {
      setState({ phase: "result", status, benchmark });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      setState({ phase: "connected", status });
    } else {
      setState({
        phase: "error",
        status,
        message: describeAgentError(error)
      });
    }
  } finally {
    if (requestController === controller) requestController = null;
  }
}

async function stopCodex(status: AgentStatusResponse): Promise<void> {
  requestController?.abort();
  if (connection) {
    try {
      await cancelAgentCodexBenchmark(connection);
    } catch {
      // Disconnecting the POST request also causes the Agent to abort the process.
    }
  }
  setState({ phase: "connected", status });
}

function disconnect(): void {
  requestController?.abort();
  requestController = null;
  connection = null;
  setState({ phase: "disconnected" });
}

function bindPanelEvents(mount: HTMLElement): void {
  mount
    .querySelector<HTMLFormElement>("#agent-connect-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      void connectFromForm(mount);
    });
  mount
    .querySelector<HTMLButtonElement>("#agent-disconnect-button")
    ?.addEventListener("click", disconnect);
  mount
    .querySelector<HTMLButtonElement>("#agent-run-button")
    ?.addEventListener("click", () => {
      if (
        state.phase === "connected" ||
        state.phase === "result" ||
        state.phase === "error"
      ) {
        if (state.status) void runCodex(state.status);
      }
    });
  mount
    .querySelector<HTMLButtonElement>("#agent-stop-button")
    ?.addEventListener("click", () => {
      if (state.phase === "running") void stopCodex(state.status);
    });
}

new MutationObserver(scheduleMount).observe(appRoot, {
  childList: true,
  subtree: true
});

renderPanel();
