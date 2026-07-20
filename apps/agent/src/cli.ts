import { startAgentServer } from "./server.ts";

const server = await startAgentServer({
  allowedOrigins: ["https://jacklv-coder.github.io"]
});

console.log("AI Network Check Agent");
console.log(`Listening: ${server.origin}`);
console.log(`Session token: ${server.token}`);
console.log("No network or CLI benchmark commands are enabled in this foundation build.");

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
