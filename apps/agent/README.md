# AI Network Check Local Agent

The Local Agent runs only on loopback and enables two professional checks from the web application:

- catalog-bound DNS / TCP / TLS / TTFB measurements
- a fixed real Codex CLI benchmark that asks only for `OK`

## Build

From the repository root:

```bash
npm install
npm run build:agent
```

The self-contained executable is generated at:

```text
apps/agent/dist/ai-network-check-agent.mjs
```

Run it with Node.js 22.12 or newer:

```bash
node apps/agent/dist/ai-network-check-agent.mjs
```

The process prints its loopback URL and a random session token. Paste that token into the AI Network Check web page. The token is kept only in page memory.

## Optional port

The default port is `3210`. Set an ephemeral or custom loopback port with:

```bash
AI_NETWORK_CHECK_AGENT_PORT=0 node apps/agent/dist/ai-network-check-agent.mjs
```

The value must be an integer from `0` through `65535`. A value of `0` lets the operating system select an available port.

## Security boundaries

- listens on `127.0.0.1` by default
- validates the `Host` and browser `Origin` headers
- requires a high-entropy bearer session token
- accepts no arbitrary shell command, prompt, or URL
- returns no credentials, model response text, stdout, or stderr
