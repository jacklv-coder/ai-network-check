import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { listServices } from "../../../packages/core/src/index.ts";
import {
  CODEX_BENCHMARK_PROMPT_ID,
  runCodexCliBenchmark
} from "../../../packages/cli-benchmark/src/index.ts";
import { runNetworkPhaseBenchmark } from "../../../packages/network-phase-benchmark/src/index.ts";
import { runCatalogNetworkPhaseBenchmark } from "./network-phases.ts";
import type {
  AgentHealthResponse,
  AgentServerDependencies,
  AgentServerOptions,
  AgentStatusResponse,
  CodexBenchmarkApiResponse,
  LoopbackHost,
  RunningAgentServer
} from "./types.ts";

const DEFAULT_HOST: LoopbackHost = "127.0.0.1";
const DEFAULT_PORT = 3210;
const CODEX_PATH = "/v1/benchmarks/codex";
const NETWORK_PHASE_BASE_PATH = "/v1/benchmarks/network-phases";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
} as const;

const DEFAULT_DEPENDENCIES: AgentServerDependencies = {
  listServices,
  runCodexBenchmark: (options) => runCodexCliBenchmark(options),
  runNetworkPhaseBenchmark: (options) => runNetworkPhaseBenchmark(options)
};

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("port must be an integer between 0 and 65535");
  }
}

function validateToken(token: string): void {
  if (token.length < 32) {
    throw new RangeError("token must contain at least 32 characters");
  }
}

function normalizedOrigins(origins: readonly string[]): ReadonlySet<string> {
  const values = new Set<string>();
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError(`Invalid allowed origin: ${origin}`);
    }
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    ) {
      throw new TypeError(
        `Allowed origin must be an exact HTTP(S) origin: ${origin}`
      );
    }
    values.add(origin);
  }
  return values;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, {
    ...JSON_HEADERS,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function writeEmpty(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers
  });
  response.end();
}

function tokenMatches(expected: string, authorization: string | undefined): boolean {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return false;
  const supplied = authorization.slice(prefix.length);
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function allowedHostHeader(header: string | undefined, port: number): boolean {
  if (!header) return false;
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`
  ]);
  return allowed.has(header.toLowerCase());
}

function corsHeaders(
  request: IncomingMessage,
  origins: ReadonlySet<string>
): Record<string, string> | null {
  const origin = request.headers.origin;
  if (!origin) return {};
  if (!origins.has(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

function health(): AgentHealthResponse {
  return { ok: true, name: "ai-network-check-agent", version: 1 };
}

function requestHasBody(request: IncomingMessage): boolean {
  if (request.headers["transfer-encoding"]) return true;
  const length = request.headers["content-length"];
  if (!length) return false;
  const parsed = Number(length);
  return !Number.isFinite(parsed) || parsed > 0;
}

function parseNetworkPhaseServiceId(pathname: string): string | null {
  const prefix = `${NETWORK_PHASE_BASE_PATH}/`;
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}

export async function startAgentServer(
  options: AgentServerOptions = {},
  dependencyOverrides: Partial<AgentServerDependencies> = {}
): Promise<RunningAgentServer> {
  const dependencies: AgentServerDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencyOverrides
  };
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  validatePort(requestedPort);
  const token = options.token ?? randomBytes(32).toString("base64url");
  validateToken(token);
  const allowedOrigins = normalizedOrigins(options.allowedOrigins ?? []);

  let actualPort = requestedPort;
  let activeCodexController: AbortController | null = null;
  let activeNetworkPhaseController: AbortController | null = null;

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (!allowedHostHeader(request.headers.host, actualPort)) {
      writeJson(response, 421, { error: "invalid-host" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, health());
      return;
    }

    const networkPhaseServiceId = parseNetworkPhaseServiceId(url.pathname);
    const knownProtectedRoute =
      url.pathname === "/v1/status" ||
      url.pathname === CODEX_PATH ||
      url.pathname === NETWORK_PHASE_BASE_PATH ||
      networkPhaseServiceId !== null;
    if (!knownProtectedRoute) {
      writeJson(response, 404, { error: "not-found" });
      return;
    }

    const cors = corsHeaders(request, allowedOrigins);
    if (cors === null) {
      writeJson(response, 403, { error: "origin-not-allowed" });
      return;
    }

    if (request.method === "OPTIONS") {
      writeEmpty(response, 204, cors);
      return;
    }

    if (!tokenMatches(token, request.headers.authorization)) {
      writeJson(response, 401, { error: "unauthorized" }, cors);
      return;
    }

    if (url.pathname === "/v1/status") {
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "method-not-allowed" }, cors);
        return;
      }
      const body: AgentStatusResponse = {
        ...health(),
        authenticated: true,
        host,
        port: actualPort,
        codexBenchmarkRunning: activeCodexController !== null,
        networkPhaseBenchmarkRunning: activeNetworkPhaseController !== null,
        capabilities: {
          networkPhases: true,
          publicWebSocket: false,
          codexCli: true,
          claudeCodeCli: false
        }
      };
      writeJson(response, 200, body, cors);
      return;
    }

    if (url.pathname === CODEX_PATH) {
      if (request.method === "DELETE") {
        if (!activeCodexController) {
          writeJson(response, 404, { error: "no-active-benchmark" }, cors);
          return;
        }
        activeCodexController.abort();
        writeJson(response, 202, { cancelled: true }, cors);
        return;
      }

      if (request.method !== "POST") {
        writeJson(response, 405, { error: "method-not-allowed" }, cors);
        return;
      }

      if (requestHasBody(request)) {
        request.resume();
        writeJson(response, 400, { error: "request-body-not-allowed" }, cors);
        return;
      }

      if (activeCodexController || activeNetworkPhaseController) {
        writeJson(response, 409, { error: "benchmark-already-running" }, cors);
        return;
      }

      const runController = new AbortController();
      activeCodexController = runController;
      const abortOnDisconnect = () => runController.abort();
      request.once("aborted", abortOnDisconnect);
      response.once("close", () => {
        if (!response.writableEnded) abortOnDisconnect();
      });

      try {
        const result = await dependencies.runCodexBenchmark({
          signal: runController.signal
        });
        if (!response.destroyed) {
          const body: CodexBenchmarkApiResponse = {
            promptId: CODEX_BENCHMARK_PROMPT_ID,
            result
          };
          writeJson(response, 200, body, cors);
        }
      } catch {
        if (!response.destroyed) {
          writeJson(response, 500, { error: "benchmark-failed" }, cors);
        }
      } finally {
        request.off("aborted", abortOnDisconnect);
        if (activeCodexController === runController) {
          activeCodexController = null;
        }
      }
      return;
    }

    if (url.pathname === NETWORK_PHASE_BASE_PATH) {
      if (request.method !== "DELETE") {
        writeJson(response, 405, { error: "method-not-allowed" }, cors);
        return;
      }
      if (!activeNetworkPhaseController) {
        writeJson(response, 404, { error: "no-active-benchmark" }, cors);
        return;
      }
      activeNetworkPhaseController.abort();
      writeJson(response, 202, { cancelled: true }, cors);
      return;
    }

    if (networkPhaseServiceId === null) {
      writeJson(response, 404, { error: "not-found" }, cors);
      return;
    }

    if (request.method !== "POST") {
      writeJson(response, 405, { error: "method-not-allowed" }, cors);
      return;
    }

    if (requestHasBody(request)) {
      request.resume();
      writeJson(response, 400, { error: "request-body-not-allowed" }, cors);
      return;
    }

    const service = dependencies
      .listServices()
      .find((candidate) => candidate.id === networkPhaseServiceId);
    if (!service) {
      writeJson(response, 404, { error: "unknown-service" }, cors);
      return;
    }

    if (activeCodexController || activeNetworkPhaseController) {
      writeJson(response, 409, { error: "benchmark-already-running" }, cors);
      return;
    }

    const runController = new AbortController();
    activeNetworkPhaseController = runController;
    const abortOnDisconnect = () => runController.abort();
    request.once("aborted", abortOnDisconnect);
    response.once("close", () => {
      if (!response.writableEnded) abortOnDisconnect();
    });

    try {
      const result = await runCatalogNetworkPhaseBenchmark(
        service,
        runController.signal,
        dependencies
      );
      if (!response.destroyed) {
        writeJson(response, 200, result, cors);
      }
    } catch {
      if (!response.destroyed) {
        writeJson(response, 500, { error: "benchmark-failed" }, cors);
      }
    } finally {
      request.off("aborted", abortOnDisconnect);
      if (activeNetworkPhaseController === runController) {
        activeNetworkPhaseController = null;
      }
    }
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) {
        writeJson(response, 500, { error: "internal-error" });
      } else if (!response.destroyed) {
        response.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Agent server did not expose a TCP address");
  }
  actualPort = address.port;
  const origin = `http://${host === "::1" ? `[${host}]` : host}:${actualPort}`;

  return {
    server,
    host,
    port: actualPort,
    origin,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        activeCodexController?.abort();
        activeNetworkPhaseController?.abort();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
