import { startAgentServer } from "./server.ts";

const server = await startAgentServer({
  allowedOrigins: [
    "https://jacklv-coder.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]
});

console.log("AI Network Check Agent");
console.log(`Listening: ${server.origin}`);
console.log(`Session token: ${server.token}`);
console.log("The fixed real Codex benchmark API is enabled.");
console.log("Catalog-bound DNS/TCP/TLS/TTFB benchmark APIs are enabled.");
console.log("The session token is not stored by the web application.");

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
