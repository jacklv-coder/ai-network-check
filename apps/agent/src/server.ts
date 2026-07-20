import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  AgentHealthResponse,
  AgentServerOptions,
  AgentStatusResponse,
  LoopbackHost,
  RunningAgentServer
} from "./types.ts";

const DEFAULT_HOST: LoopbackHost = "127.0.0.1";
const DEFAULT_PORT = 3210;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

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
      throw new TypeError(`Allowed origin must be an exact HTTP(S) origin: ${origin}`);
    }
    values.add(origin);
  }
  return values;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    ...JSON_HEADERS,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
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
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

function health(): AgentHealthResponse {
  return { ok: true, name: "ai-network-check-agent", version: 1 };
}

export async function startAgentServer(
  options: AgentServerOptions = {}
): Promise<RunningAgentServer> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  validatePort(requestedPort);
  const token = options.token ?? randomBytes(32).toString("base64url");
  validateToken(token);
  const allowedOrigins = normalizedOrigins(options.allowedOrigins ?? []);

  let actualPort = requestedPort;
  const server = createServer((request, response) => {
    if (!allowedHostHeader(request.headers.host, actualPort)) {
      writeJson(response, 421, { error: "invalid-host" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, health());
      return;
    }

    if (url.pathname !== "/v1/status") {
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

    if (request.method !== "GET") {
      writeJson(response, 405, { error: "method-not-allowed" });
      return;
    }

    if (!tokenMatches(token, request.headers.authorization)) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const body: AgentStatusResponse = {
      ...health(),
      authenticated: true,
      host,
      port: actualPort,
      capabilities: {
        networkPhases: false,
        publicWebSocket: false,
        codexCli: false,
        claudeCodeCli: false
      }
    };
    response.writeHead(200, {
      ...JSON_HEADERS,
      ...cors,
      "cache-control": "no-store"
    });
    response.end(JSON.stringify(body));
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
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
