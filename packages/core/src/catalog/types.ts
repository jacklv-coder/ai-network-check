export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "alibaba-cloud"
  | "deepseek";

export type ProductId =
  | "chatgpt"
  | "openai-api"
  | "codex"
  | "claude"
  | "anthropic-api"
  | "claude-code"
  | "gemini"
  | "gemini-api"
  | "qwen"
  | "dashscope-api"
  | "deepseek"
  | "deepseek-api";

export type BenchmarkCapability =
  | "browser-https"
  | "browser-public-websocket"
  | "local-network-phases"
  | "local-real-tool";

export type EndpointRole = "primary" | "api" | "auth" | "static";

export type BrowserRequestMode = "cors" | "no-cors";

export type VerificationLimitation =
  | "opaque-response"
  | "http-status-unverified"
  | "websocket-unverified"
  | "real-tool-unverified";

export interface ServiceEndpoint {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly role: EndpointRole;
  readonly critical: boolean;
  readonly browserRequestMode: BrowserRequestMode;
}

export interface AIServiceDefinition {
  readonly id: string;
  readonly provider: ProviderId;
  readonly displayName: string;
  readonly products: readonly ProductId[];
  readonly capabilities: readonly BenchmarkCapability[];
  readonly limitations: readonly VerificationLimitation[];
  readonly endpoints: readonly ServiceEndpoint[];
}
