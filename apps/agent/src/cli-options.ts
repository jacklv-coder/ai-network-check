import type { AgentServerOptions } from "./types.ts";

export const DEFAULT_AGENT_PORT = 3210;
export const DEFAULT_AGENT_ALLOWED_ORIGINS = [
  "https://jacklv-coder.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
] as const;

export function resolveAgentCliOptions(
  environment: Readonly<Record<string, string | undefined>> = process.env
): AgentServerOptions {
  const rawPort = environment.AI_NETWORK_CHECK_AGENT_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_AGENT_PORT;

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(
      "AI_NETWORK_CHECK_AGENT_PORT must be an integer between 0 and 65535"
    );
  }

  return {
    port,
    allowedOrigins: DEFAULT_AGENT_ALLOWED_ORIGINS
  };
}
