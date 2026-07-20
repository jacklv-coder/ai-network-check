import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import type {
  NetworkPhaseBenchmarkDependencies,
  NetworkPhaseBenchmarkOptions,
  NetworkPhaseBenchmarkResult,
  NetworkPhaseBenchmarkStatus
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_DEPENDENCIES: NetworkPhaseBenchmarkDependencies = {
  request: (url, options, onResponse) =>
    httpsRequest(url, options, onResponse),
  now: () => performance.now()
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function parseTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TypeError("url must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new TypeError("url must use HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError("url must not contain credentials");
  }
  return url;
}

function classifyError(
  error: NodeJS.ErrnoException,
  stage: "dns" | "tcp" | "tls" | "request"
): NetworkPhaseBenchmarkStatus {
  if (error.name === "AbortError") return "cancelled";
  if (error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT") {
    return "timeout";
  }
  if (
    stage === "dns" ||
    error.code === "ENOTFOUND" ||
    error.code === "EAI_AGAIN"
  ) {
    return "dns-error";
  }
  if (
    stage === "tls" ||
    error.code?.startsWith("ERR_TLS") ||
    error.code?.includes("CERT") ||
    error.code?.startsWith("DEPTH_ZERO")
  ) {
    return "tls-error";
  }
  if (
    stage === "tcp" ||
    error.code === "ECONNREFUSED" ||
    error.code === "ENETUNREACH" ||
    error.code === "EHOSTUNREACH"
  ) {
    return "tcp-error";
  }
  return "request-error";
}

function safeDuration(end: number, start: number): number {
  return Math.max(0, end - start);
}

export function runNetworkPhaseBenchmark(
  options: NetworkPhaseBenchmarkOptions,
  dependencyOverrides: Partial<NetworkPhaseBenchmarkDependencies> = {}
): Promise<NetworkPhaseBenchmarkResult> {
  const target = parseTarget(options.url);
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs"
  );
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };

  if (options.signal?.aborted) {
    return Promise.resolve({
      url: target.toString(),
      hostname: target.hostname,
      status: "cancelled",
      resolvedAddress: null,
      addressFamily: null,
      httpStatus: null,
      phases: null,
      errorCode: null
    });
  }

  return new Promise((resolve) => {
    const startedAt = dependencies.now();
    let settled = false;
    let request: ClientRequest | null = null;
    let socketAssignedAt = startedAt;
    let lookupAt: number | null = null;
    let connectedAt: number | null = null;
    let secureAt: number | null = null;
    let resolvedAddress: string | null = null;
    let addressFamily: number | null = null;
    let stage: "dns" | "tcp" | "tls" | "request" = "dns";

    const finish = (result: NetworkPhaseBenchmarkResult) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abortHandler);
      resolve(result);
    };

    const fail = (status: NetworkPhaseBenchmarkStatus, code: string | null) => {
      finish({
        url: target.toString(),
        hostname: target.hostname,
        status,
        resolvedAddress,
        addressFamily,
        httpStatus: null,
        phases: null,
        errorCode: code
      });
    };

    const abortHandler = () => {
      request?.destroy(
        Object.assign(new Error("Aborted"), { name: "AbortError" })
      );
      fail("cancelled", null);
    };

    try {
      request = dependencies.request(
        target,
        {
          method: "HEAD",
          agent: false,
          timeout: timeoutMs,
          headers: {
            "user-agent": "ai-network-check-agent/1",
            accept: "*/*",
            connection: "close"
          }
        },
        (response: IncomingMessage) => {
          const responseAt = dependencies.now();
          stage = "request";
          response.resume();
          response.destroy();

          const tcpStart = lookupAt ?? socketAssignedAt;
          const connectTime = connectedAt ?? tcpStart;
          const secureTime = secureAt ?? connectTime;
          finish({
            url: target.toString(),
            hostname: target.hostname,
            status: "success",
            resolvedAddress,
            addressFamily,
            httpStatus: response.statusCode ?? null,
            phases: {
              dnsMs:
                lookupAt === null ? 0 : safeDuration(lookupAt, startedAt),
              tcpMs: safeDuration(connectTime, tcpStart),
              tlsMs: safeDuration(secureTime, connectTime),
              requestToFirstByteMs: safeDuration(responseAt, secureTime),
              totalToFirstByteMs: safeDuration(responseAt, startedAt)
            },
            errorCode: null
          });
        }
      );

      request.once("socket", (socket) => {
        socketAssignedAt = dependencies.now();
        stage = "dns";

        socket.once(
          "lookup",
          (error: Error | null, address: string, family: number) => {
            lookupAt = dependencies.now();
            if (error) {
              stage = "dns";
              return;
            }
            resolvedAddress = address;
            addressFamily = family;
            stage = "tcp";
          }
        );
        socket.once("connect", () => {
          connectedAt = dependencies.now();
          stage = "tls";
          if (!resolvedAddress) {
            const remoteAddress = socket.remoteAddress;
            if (remoteAddress) resolvedAddress = remoteAddress;
            addressFamily = socket.remoteFamily === "IPv6" ? 6 : 4;
          }
        });
        (socket as TLSSocket).once("secureConnect", () => {
          secureAt = dependencies.now();
          stage = "request";
        });
      });

      request.once("timeout", () => {
        request?.destroy(
          Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" })
        );
        fail("timeout", "ETIMEDOUT");
      });
      request.once("error", (error: NodeJS.ErrnoException) => {
        fail(classifyError(error, stage), error.code ?? null);
      });

      if (options.signal?.aborted) {
        abortHandler();
        return;
      }
      options.signal?.addEventListener("abort", abortHandler, { once: true });
      request.end();
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      fail(classifyError(nodeError, stage), nodeError.code ?? null);
    }
  });
}
