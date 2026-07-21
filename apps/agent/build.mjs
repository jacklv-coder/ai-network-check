import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = new URL(".", import.meta.url);
const distDirectory = resolve(root.pathname, "dist");
const outfile = resolve(distDirectory, "ai-network-check-agent.mjs");

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });

await build({
  entryPoints: [resolve(root.pathname, "src/cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  sourcemap: false,
  minify: false,
  logLevel: "info"
});

await chmod(outfile, 0o755);
console.log(`Built ${outfile}`);
