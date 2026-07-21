import "./agent.css";

import { listServices } from "@ai-network-check/core";
import {
  AgentApiError,
  cancelAgentCodexBenchmark,
  cancelAgentNetworkPhaseBenchmark,
  connectAgent,
  runAgentCodexBenchmark,
  runAgentNetworkPhaseBenchmark,
  type AgentConnection,
  type AgentStatusResponse
} from "./agent-client.ts";
import { evidenceSession } from "./evidence-session.ts";
import {
  renderAgentPanel,
  type AgentServiceOption,
  type AgentUiState
} from "./agent-view.ts";

const appRootElement = document.querySelector("#app");

if (!(appRootElement instanceof HTMLElement)) {
  throw new Error("Missing #app root element");
}

const appRoot: HTMLElement = appRootElement;
const agentServices: readonly AgentServiceOption[] = listServices().map(
  (service) => ({ id: service.id, label: service.displayName })
);
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

  mount.innerHTML = renderAgentPanel(state, agentServices);
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
      "benchmark-already-running": "本地 Agent 已有一个检测正在运行。",
      "unknown-service": "本地 Agent 不认识这个 AI 服务，请更新项目后重试。",
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
      evidenceSession.attachCodex(benchmark);
      setState({ phase: "result", status, benchmark });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      setState({ phase: "connected", status });
    } else {
      setState({
        phase: "error",
        operation: "codex",
        status,
        message: describeAgentError(error)
      });
    }
  } finally {
    if (requestController === controller) requestController = null;
  }
}

async function runNetworkPhases(
  status: AgentStatusResponse,
  serviceId: string
): Promise<void> {
  if (!connection) return;
  const serviceName =
    agentServices.find((service) => service.id === serviceId)?.label ?? serviceId;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  setState({ phase: "network-running", status, serviceId, serviceName });

  try {
    const benchmark = await runAgentNetworkPhaseBenchmark(
      connection,
      serviceId,
      controller.signal
    );
    if (!controller.signal.aborted) {
      evidenceSession.attachLocalNetwork(benchmark);
      setState({ phase: "network-result", status, benchmark });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      setState({ phase: "connected", status });
    } else {
      setState({
        phase: "error",
        operation: "network",
        serviceId,
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

async function stopNetworkPhases(status: AgentStatusResponse): Promise<void> {
  requestController?.abort();
  if (connection) {
    try {
      await cancelAgentNetworkPhaseBenchmark(connection);
    } catch {
      // Disconnecting the POST request also aborts the active network phase run.
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

function currentStatus(): AgentStatusResponse | null {
  return "status" in state ? state.status ?? null : null;
}

function selectedNetworkService(mount: HTMLElement): string | null {
  return (
    mount.querySelector<HTMLSelectElement>("#agent-network-service")?.value ?? null
  );
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
      const status = currentStatus();
      if (status) void runCodex(status);
    });
  mount
    .querySelector<HTMLButtonElement>("#agent-network-run-button")
    ?.addEventListener("click", () => {
      const status = currentStatus();
      const serviceId = selectedNetworkService(mount);
      if (status && serviceId) void runNetworkPhases(status, serviceId);
    });
  mount
    .querySelector<HTMLButtonElement>("#agent-stop-button")
    ?.addEventListener("click", () => {
      if (state.phase === "running") void stopCodex(state.status);
    });
  mount
    .querySelector<HTMLButtonElement>("#agent-network-stop-button")
    ?.addEventListener("click", () => {
      if (state.phase === "network-running") {
        void stopNetworkPhases(state.status);
      }
    });
}

new MutationObserver(scheduleMount).observe(appRoot, {
  childList: true,
  subtree: true
});

renderPanel();
