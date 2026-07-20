import {
  summarizeBenchmarkSamples,
  type BenchmarkSample
} from "../../core/src/index.ts";
import type {
  WebSocketBenchmarkDependencies,
  WebSocketBenchmarkOptions,
  WebSocketBenchmarkProgress,
  WebSocketBenchmarkResult,
  WebSocketCloseInfo,
  WebSocketLike
} from "./types.ts";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 7_000;
const DEFAULT_DURATION_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5_000;
const OPEN_STATE = 1;
const CLOSING_STATE = 2;
const CLOSED_STATE = 3;

export class WebSocketBenchmarkCancelledError extends Error {
  constructor() {
    super("WebSocket benchmark was cancelled");
    this.name = "WebSocketBenchmarkCancelledError";
  }
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function defaultSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(resolve, durationMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true }
    );
  });
}

const DEFAULT_DEPENDENCIES: WebSocketBenchmarkDependencies = {
  createWebSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  now: () => performance.now(),
  sleep: defaultSleep,
  createSessionId: () => crypto.randomUUID()
};

interface ResolvedOptions {
  readonly url: string;
  readonly handshakeTimeoutMs: number;
  readonly durationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: WebSocketBenchmarkProgress) => void;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function resolveOptions(options: WebSocketBenchmarkOptions): ResolvedOptions {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new TypeError("url must be a valid WebSocket URL");
  }
  if (parsed.protocol !== "wss:") {
    throw new TypeError("url must use the secure wss protocol");
  }

  return {
    url: parsed.toString(),
    handshakeTimeoutMs: positiveInteger(
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
      "handshakeTimeoutMs"
    ),
    durationMs: positiveInteger(options.durationMs ?? DEFAULT_DURATION_MS, "durationMs"),
    heartbeatIntervalMs: positiveInteger(
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      "heartbeatIntervalMs"
    ),
    heartbeatTimeoutMs: positiveInteger(
      options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      "heartbeatTimeoutMs"
    ),
    signal: options.signal,
    onProgress: options.onProgress
  };
}

function mergeDependencies(
  overrides: Partial<WebSocketBenchmarkDependencies> | undefined
): WebSocketBenchmarkDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function cancellationPromise(signal?: AbortSignal): Promise<"cancelled"> {
  if (!signal) {
    return new Promise(() => undefined);
  }
  if (signal.aborted) {
    return Promise.resolve("cancelled");
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
  });
}

function normalizeClose(event: {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}): WebSocketCloseInfo {
  return {
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean
  };
}

function emitProgress(
  options: ResolvedOptions,
  type: WebSocketBenchmarkProgress["type"],
  handshakeMs: number | null,
  samples: readonly BenchmarkSample[],
  sentCount: number,
  receivedCount: number,
  lostCount: number,
  latestSample: BenchmarkSample | null
): void {
  options.onProgress?.({
    type,
    url: options.url,
    handshakeMs,
    sentCount,
    receivedCount,
    lostCount,
    latestSample,
    metrics: summarizeBenchmarkSamples(samples)
  });
}

export async function runWebSocketBenchmark(
  optionsInput: WebSocketBenchmarkOptions,
  dependencyOverrides?: Partial<WebSocketBenchmarkDependencies>
): Promise<WebSocketBenchmarkResult> {
  const options = resolveOptions(optionsInput);
  const dependencies = mergeDependencies(dependencyOverrides);

  if (options.signal?.aborted) {
    throw new WebSocketBenchmarkCancelledError();
  }

  const startedAt = dependencies.now();
  const socket = dependencies.createWebSocket(options.url);
  const samples: BenchmarkSample[] = [];
  const pendingEchoes = new Map<string, (receivedAt: number) => void>();
  let closeInfo: WebSocketCloseInfo | null = null;
  let connectionErrored = false;
  let terminationResolve!: (outcome: "closed" | "error") => void;
  const termination = new Promise<"closed" | "error">((resolve) => {
    terminationResolve = resolve;
  });
  let openResolve!: () => void;
  let openReject!: (outcome: "closed" | "error") => void;
  const opened = new Promise<void>((resolve, reject) => {
    openResolve = resolve;
    openReject = reject;
  });

  socket.onopen = () => openResolve();
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const resolve = pendingEchoes.get(event.data);
    if (!resolve) return;
    pendingEchoes.delete(event.data);
    resolve(dependencies.now());
  };
  socket.onerror = () => {
    connectionErrored = true;
    openReject("error");
    terminationResolve("error");
  };
  socket.onclose = (event) => {
    closeInfo = normalizeClose(event);
    openReject("closed");
    terminationResolve("closed");
  };

  emitProgress(options, "connecting", null, samples, 0, 0, 0, null);

  const handshakeOutcome = await Promise.race([
    opened.then(() => "open" as const).catch((outcome: "closed" | "error") => outcome),
    dependencies.sleep(options.handshakeTimeoutMs, options.signal).then(
      () => "timeout" as const,
      (error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return "cancelled" as const;
        }
        throw error;
      }
    ),
    cancellationPromise(options.signal)
  ]);

  if (handshakeOutcome === "cancelled") {
    if (socket.readyState !== CLOSING_STATE && socket.readyState !== CLOSED_STATE) {
      socket.close(1000, "cancelled");
    }
    throw new WebSocketBenchmarkCancelledError();
  }

  if (handshakeOutcome !== "open") {
    if (socket.readyState !== CLOSING_STATE && socket.readyState !== CLOSED_STATE) {
      socket.close(1000, "handshake-failed");
    }
    const status =
      handshakeOutcome === "timeout" ? "handshake-timeout" : "connection-error";
    return {
      url: options.url,
      status,
      handshakeMs: null,
      connectionDurationMs: 0,
      targetDurationMs: options.durationMs,
      sentCount: 0,
      receivedCount: 0,
      lostCount: 0,
      samples,
      metrics: summarizeBenchmarkSamples(samples),
      close: closeInfo
    };
  }

  const openedAt = dependencies.now();
  const handshakeMs = Math.max(0, openedAt - startedAt);
  let sentCount = 0;
  let receivedCount = 0;
  let lostCount = 0;
  let status: WebSocketBenchmarkResult["status"] = "completed";
  const sessionId = dependencies.createSessionId();

  emitProgress(options, "connected", handshakeMs, samples, 0, 0, 0, null);

  try {
    while (dependencies.now() - openedAt < options.durationMs) {
      if (options.signal?.aborted) {
        throw new WebSocketBenchmarkCancelledError();
      }
      if (socket.readyState !== OPEN_STATE) {
        status = connectionErrored ? "connection-error" : "closed-early";
        break;
      }

      const index = sentCount;
      const sentAt = dependencies.now();
      const payload = JSON.stringify({
        type: "ai-network-check-heartbeat",
        sessionId,
        index,
        sentAt
      });
      let echoResolve!: (receivedAt: number) => void;
      const echo = new Promise<number>((resolve) => {
        echoResolve = resolve;
      });
      pendingEchoes.set(payload, echoResolve);

      try {
        socket.send(payload);
        sentCount += 1;
      } catch {
        pendingEchoes.delete(payload);
        const sample: BenchmarkSample = { status: "network-error", durationMs: 0 };
        samples.push(sample);
        status = "connection-error";
        emitProgress(
          options,
          "heartbeat",
          handshakeMs,
          samples,
          sentCount,
          receivedCount,
          lostCount,
          sample
        );
        break;
      }

      const heartbeatOutcome = await Promise.race([
        echo.then((receivedAt) => ({ type: "echo" as const, receivedAt })),
        dependencies.sleep(options.heartbeatTimeoutMs, options.signal).then(
          () => ({ type: "timeout" as const }),
          (error) => {
            if (error instanceof Error && error.name === "AbortError") {
              return { type: "cancelled" as const };
            }
            throw error;
          }
        ),
        termination.then((outcome) => ({ type: outcome } as const)),
        cancellationPromise(options.signal).then(() => ({ type: "cancelled" as const }))
      ]);

      pendingEchoes.delete(payload);
      let latestSample: BenchmarkSample;
      if (heartbeatOutcome.type === "cancelled") {
        throw new WebSocketBenchmarkCancelledError();
      }
      if (heartbeatOutcome.type === "echo") {
        latestSample = {
          status: "success",
          durationMs: Math.max(0, heartbeatOutcome.receivedAt - sentAt)
        };
        receivedCount += 1;
      } else if (heartbeatOutcome.type === "timeout") {
        latestSample = {
          status: "timeout",
          durationMs: options.heartbeatTimeoutMs
        };
        lostCount += 1;
      } else {
        latestSample = { status: "network-error", durationMs: 0 };
        lostCount += 1;
        status = heartbeatOutcome.type === "error" ? "connection-error" : "closed-early";
      }
      samples.push(latestSample);
      emitProgress(
        options,
        "heartbeat",
        handshakeMs,
        samples,
        sentCount,
        receivedCount,
        lostCount,
        latestSample
      );

      if (heartbeatOutcome.type === "closed" || heartbeatOutcome.type === "error") {
        break;
      }

      const elapsed = dependencies.now() - openedAt;
      const remaining = options.durationMs - elapsed;
      if (remaining <= 0) break;

      const intervalOutcome = await Promise.race([
        dependencies
          .sleep(Math.min(options.heartbeatIntervalMs, remaining), options.signal)
          .then(
            () => "elapsed" as const,
            (error) => {
              if (error instanceof Error && error.name === "AbortError") {
                return "cancelled" as const;
              }
              throw error;
            }
          ),
        termination,
        cancellationPromise(options.signal)
      ]);
      if (intervalOutcome === "cancelled") {
        throw new WebSocketBenchmarkCancelledError();
      }
      if (intervalOutcome === "closed" || intervalOutcome === "error") {
        status = intervalOutcome === "error" ? "connection-error" : "closed-early";
        break;
      }
    }
  } catch (error) {
    if (error instanceof WebSocketBenchmarkCancelledError) {
      if (socket.readyState !== CLOSING_STATE && socket.readyState !== CLOSED_STATE) {
        socket.close(1000, "cancelled");
      }
      throw error;
    }
    throw error;
  }

  const connectionDurationMs = Math.max(0, dependencies.now() - openedAt);
  if (
    status === "completed" &&
    socket.readyState !== CLOSING_STATE &&
    socket.readyState !== CLOSED_STATE
  ) {
    socket.close(1000, "benchmark-complete");
  }

  emitProgress(
    options,
    "completed",
    handshakeMs,
    samples,
    sentCount,
    receivedCount,
    lostCount,
    samples.at(-1) ?? null
  );

  return {
    url: options.url,
    status,
    handshakeMs,
    connectionDurationMs,
    targetDurationMs: options.durationMs,
    sentCount,
    receivedCount,
    lostCount,
    samples,
    metrics: summarizeBenchmarkSamples(samples),
    close: closeInfo
  };
}
