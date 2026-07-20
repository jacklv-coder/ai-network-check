import type { AIServiceDefinition } from "./types.ts";

/**
 * Initial service catalog.
 *
 * The catalog records origins and roles only. Probe paths, request strategy,
 * timeouts, and scoring belong to later benchmark modules.
 */
export const AI_SERVICE_CATALOG = [
  {
    id: "openai",
    provider: "openai",
    displayName: "OpenAI",
    products: ["chatgpt", "openai-api", "codex"],
    capabilities: ["browser-https", "local-network-phases", "local-real-tool"],
    limitations: [
      "opaque-response",
      "http-status-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ],
    endpoints: [
      {
        id: "openai-chatgpt",
        label: "ChatGPT",
        url: "https://chatgpt.com/",
        role: "primary",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "openai-api",
        label: "OpenAI API",
        url: "https://api.openai.com/",
        role: "api",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "openai-auth",
        label: "OpenAI Authentication",
        url: "https://auth.openai.com/",
        role: "auth",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "openai-static",
        label: "OpenAI Static Assets",
        url: "https://oaistatic.com/",
        role: "static",
        critical: false,
        browserRequestMode: "no-cors"
      }
    ]
  },
  {
    id: "anthropic",
    provider: "anthropic",
    displayName: "Anthropic",
    products: ["claude", "anthropic-api", "claude-code"],
    capabilities: ["browser-https", "local-network-phases", "local-real-tool"],
    limitations: [
      "opaque-response",
      "http-status-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ],
    endpoints: [
      {
        id: "anthropic-claude",
        label: "Claude",
        url: "https://claude.ai/",
        role: "primary",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "anthropic-api",
        label: "Anthropic API",
        url: "https://api.anthropic.com/",
        role: "api",
        critical: true,
        browserRequestMode: "no-cors"
      }
    ]
  },
  {
    id: "google-gemini",
    provider: "google",
    displayName: "Google Gemini",
    products: ["gemini", "gemini-api"],
    capabilities: ["browser-https", "local-network-phases"],
    limitations: [
      "opaque-response",
      "http-status-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ],
    endpoints: [
      {
        id: "google-gemini",
        label: "Gemini",
        url: "https://gemini.google.com/",
        role: "primary",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "google-gemini-api",
        label: "Gemini API",
        url: "https://generativelanguage.googleapis.com/",
        role: "api",
        critical: true,
        browserRequestMode: "no-cors"
      }
    ]
  },
  {
    id: "alibaba-qwen",
    provider: "alibaba-cloud",
    displayName: "Alibaba Cloud Qwen",
    products: ["qwen", "dashscope-api"],
    capabilities: ["browser-https", "local-network-phases"],
    limitations: [
      "opaque-response",
      "http-status-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ],
    endpoints: [
      {
        id: "alibaba-dashscope-api",
        label: "DashScope API",
        url: "https://dashscope.aliyuncs.com/",
        role: "primary",
        critical: true,
        browserRequestMode: "no-cors"
      }
    ]
  },
  {
    id: "deepseek",
    provider: "deepseek",
    displayName: "DeepSeek",
    products: ["deepseek", "deepseek-api"],
    capabilities: ["browser-https", "local-network-phases"],
    limitations: [
      "opaque-response",
      "http-status-unverified",
      "websocket-unverified",
      "real-tool-unverified"
    ],
    endpoints: [
      {
        id: "deepseek-web",
        label: "DeepSeek",
        url: "https://chat.deepseek.com/",
        role: "primary",
        critical: true,
        browserRequestMode: "no-cors"
      },
      {
        id: "deepseek-api",
        label: "DeepSeek API",
        url: "https://api.deepseek.com/",
        role: "api",
        critical: true,
        browserRequestMode: "no-cors"
      }
    ]
  }
] as const satisfies readonly AIServiceDefinition[];
