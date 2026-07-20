import "./realtime.css";

import {
  runWebSocketBenchmark,
  WebSocketBenchmarkCancelledError,
  type WebSocketBenchmarkProgress
} from "@ai-network-check/websocket-benchmark";

import {
  renderRealtimePanel,
  type RealtimeUiState
} from "./realtime-view.ts";

const PUBLIC_ECHO_URL = "wss://ws.postman-echo.com/raw";
const appRoot = document.querySelector("#app");

if (!(appRoot instanceof HTMLElement)) {
  throw new Error("Missing #app root element");
}

let state: RealtimeUiState = { phase: "idle" };
let controller: AbortController | null = null;
let mountScheduled = false;

function setState(nextState: RealtimeUiState): void {
  state = nextState;
  renderPanel();
}

function createMount(): HTMLElement | null {
  const appCard = appRoot.querySelector<HTMLElement>(".app-card");
  if (!appCard) return null;

  const mount = document.createElement("div");
  mount.id = "realtime-mount";
  appCard.insertAdjacentElement("afterend", mount);
  return mount;
}

function bindPanelEvents(mount: HTMLElement): void {
  mount
    .querySelector<HTMLButtonElement>("#start-realtime-button")
    ?.addEventListener("click", () => void startRealtimeBenchmark());
  mount
    .querySelector<HTMLButtonElement>("#stop-realtime-button")
    ?.addEventListener("click", () => controller?.abort());
}

function renderPanel(): void {
  const httpsIsRunning = Boolean(appRoot.querySelector(".running-panel"));
  let mount = document.querySelector<HTMLElement>("#realtime-mount");

  if (httpsIsRunning) {
    controller?.abort();
    mount?.remove();
    return;
  }

  mount ??= createMount();
  if (!mount) return;

  mount.innerHTML = renderRealtimePanel(state);
  bindPanelEvents(mount);
}

function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  queueMicrotask(() => {
    mountScheduled = false;
    if (!document.querySelector("#realtime-mount")) {
      renderPanel();
    }
  });
}

async function startRealtimeBenchmark(): Promise<void> {
  controller?.abort();
  const runController = new AbortController();
  controller = runController;
  setState({ phase: "running", progress: null });

  try {
    const result = await runWebSocketBenchmark({
      url: PUBLIC_ECHO_URL,
      handshakeTimeoutMs: 7_000,
      durationMs: 20_000,
      heartbeatIntervalMs: 2_000,
      heartbeatTimeoutMs: 5_000,
      signal: runController.signal,
      onProgress: (progress: WebSocketBenchmarkProgress) => {
        if (!runController.signal.aborted) {
          setState({ phase: "running", progress });
        }
      }
    });
    if (!runController.signal.aborted) {
      setState({ phase: "result", result });
    }
  } catch (error) {
    if (
      runController.signal.aborted ||
      error instanceof WebSocketBenchmarkCancelledError
    ) {
      setState({ phase: "idle" });
    } else {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "公共长连接测试失败"
      });
    }
  } finally {
    if (controller === runController) {
      controller = null;
    }
  }
}

new MutationObserver(scheduleMount).observe(appRoot, {
  childList: true,
  subtree: true
});

renderPanel();
