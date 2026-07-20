export interface AgentCapabilityStatus {
  readonly networkPhases: boolean;
  readonly publicWebSocket: boolean;
  readonly codexCli: boolean;
  readonly claudeCodeCli: boolean;
}

export interface AgentStatusResponse {
  readonly ok: true;
  readonly name: "ai-network-check-agent";
  readonly version: 1;
  readonly authenticated: true;
  readonly host: "127.0.0.1" | "::1";
  readonly port: number;
  readonly codexBenchmarkRunning: boolean;
  readonly networkPhaseBenchmarkRunning: boolean;
  readonly capabilities: AgentCapabilityStatus;
}

export type CodexBenchmarkStatus =
  | "success"
  | "not-installed"
  | "not-authenticated"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "failed";

export interface CodexBenchmarkResult {
  readonly status: CodexBenchmarkStatus;
  readonly inspection: {
    readonly installed: boolean;
    readonly authenticated: boolean;
    readonly version: string | null;
  };
  readonly durationMs: number;
  readonly firstEventMs: number | null;
  readonly firstAgentMessageMs: number | null;
  readonly exitCode: number | null;
  readonly responseMatched: boolean;
  readonly sawTurnCompleted: boolean;
  readonly eventCounts: Readonly<Record<string, number>>;
}

export interface CodexBenchmarkApiResponse {
  readonly promptId: string;
  readonly result: CodexBenchmarkResult;
}

export type NetworkPhaseBenchmarkStatus =
  | "success"
  | "dns-error"
  | "tcp-error"
  | "tls-error"
  | "timeout"
  | "cancelled"
  | "request-error";

export interface NetworkPhaseDurations {
  readonly dnsMs: number;
  readonly tcpMs: number;
  readonly tlsMs: number;
  readonly requestToFirstByteMs: number;
  readonly totalToFirstByteMs: number;
}

export interface NetworkPhaseBenchmarkResult {
  readonly url: string;
  readonly hostname: string;
  readonly status: NetworkPhaseBenchmarkStatus;
  readonly resolvedAddress: string | null;
  readonly addressFamily: number | null;
  readonly httpStatus: number | null;
  readonly phases: NetworkPhaseDurations | null;
  readonly errorCode: string | null;
}

export interface NetworkPhaseEndpointApiResult {
  readonly endpointId: string;
  readonly label: string;
  readonly role: string;
  readonly critical: boolean;
  readonly result: NetworkPhaseBenchmarkResult;
}

export interface NetworkPhaseServiceApiResponse {
  readonly source: "service-catalog";
  readonly serviceId: string;
  readonly displayName: string;
  readonly cancelled: boolean;
  readonly endpoints: readonly NetworkPhaseEndpointApiResult[];
}

export interface AgentConnection {
  readonly port: number;
  readonly token: string;
}

export class AgentApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AgentApiError";
    this.status = status;
    this.code = code;
  }
}

type AgentPath =
  | "/v1/status"
  | "/v1/benchmarks/codex"
  | "/v1/benchmarks/network-phases"
  | `/v1/benchmarks/network-phases/${string}`;

type LoopbackRequestInit = RequestInit & {
  readonly targetAddressSpace?: "loopback";
};

function validateConnection(connection: AgentConnection): void {
  if (
    !Number.isInteger(connection.port) ||
    connection.port < 1 ||
    connection.port > 65_535
  ) {
    throw new RangeError("Agent port must be between 1 and 65535");
  }
  if (connection.token.length < 32) {
    throw new RangeError("Agent session token is invalid");
  }
}

function validateServiceId(serviceId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(serviceId)) {
    throw new RangeError("AI service ID is invalid");
  }
}

export function createAgentRequest(
  connection: AgentConnection,
  path: AgentPath,
  method: "GET" | "POST" | "DELETE",
  signal?: AbortSignal
): Request {
  validateConnection(connection);
  const init: LoopbackRequestInit = {
    method,
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
    headers: {
      authorization: `Bearer ${connection.token}`
    },
    targetAddressSpace: "loopback"
  };
  return new Request(
    `http://127.0.0.1:${connection.port}${path}`,
    init
  );
}

async function requestJson<T>(
  request: Request,
  fetchImpl: typeof fetch
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(request);
  } catch (error) {
    throw new AgentApiError(
      0,
      error instanceof Error && error.name === "AbortError"
        ? "request-cancelled"
        : "agent-unreachable"
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // The Agent normally returns JSON; keep a stable fallback for malformed responses.
  }

  if (!response.ok) {
    const code =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `http-${response.status}`;
    throw new AgentApiError(response.status, code);
  }

  return data as T;
}

export function connectAgent(
  connection: AgentConnection,
  fetchImpl: typeof fetch = fetch
): Promise<AgentStatusResponse> {
  return requestJson<AgentStatusResponse>(
    createAgentRequest(connection, "/v1/status", "GET"),
    fetchImpl
  );
}

export function runAgentCodexBenchmark(
  connection: AgentConnection,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<CodexBenchmarkApiResponse> {
  return requestJson<CodexBenchmarkApiResponse>(
    createAgentRequest(connection, "/v1/benchmarks/codex", "POST", signal),
    fetchImpl
  );
}

export async function cancelAgentCodexBenchmark(
  connection: AgentConnection,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  await requestJson<{ readonly cancelled: true }>(
    createAgentRequest(connection, "/v1/benchmarks/codex", "DELETE"),
    fetchImpl
  );
}

export function runAgentNetworkPhaseBenchmark(
  connection: AgentConnection,
  serviceId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<NetworkPhaseServiceApiResponse> {
  validateServiceId(serviceId);
  return requestJson<NetworkPhaseServiceApiResponse>(
    createAgentRequest(
      connection,
      `/v1/benchmarks/network-phases/${encodeURIComponent(serviceId)}`,
      "POST",
      signal
    ),
    fetchImpl
  );
}

export async function cancelAgentNetworkPhaseBenchmark(
  connection: AgentConnection,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  await requestJson<{ readonly cancelled: true }>(
    createAgentRequest(
      connection,
      "/v1/benchmarks/network-phases",
      "DELETE"
    ),
    fetchImpl
  );
}
