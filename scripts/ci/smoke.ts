#!/usr/bin/env bun
/**
 * Stdio smoke test: start the server the way an MCP client does, complete the `initialize`
 * handshake and list the tools. No API key is passed; none is needed to start.
 *
 * Usage:
 *   bun run smoke                                  # the local bundle, dist/typesafe-mcp.js
 *   bun scripts/ci/smoke.ts <command> [args...]    # e.g. an installed bin, or bunx typesafe-mcp@1.2.3
 *
 * Passes when the server reports this package's name and version and exposes jev_ask.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import pkg from "../../package.json" with { type: "json" };

/** Generous: `bunx` may download the package before the server starts. */
const TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Throws with the server's stderr attached when the handshake or the checks fail. */
export async function smoke(command: string, args: readonly string[]): Promise<void> {
  const shown = [command, ...args].join(" ");
  // A scratch cwd stops `bunx typesafe-mcp@x` from resolving this checkout instead of the registry.
  const cwd = mkdtempSync(join(tmpdir(), "typesafe-mcp-smoke-"));
  const transport = new StdioClientTransport({ command, args: [...args], cwd, stderr: "pipe" });
  const stderr: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  const client = new Client({ name: "typesafe-mcp-smoke", version: pkg.version });

  try {
    const started = performance.now();
    await withTimeout(client.connect(transport), `initialize (${shown})`);
    const server = client.getServerVersion();
    if (server?.name !== pkg.name || server.version !== pkg.version) {
      throw new Error(`server reported ${server?.name}@${server?.version}, expected ${pkg.name}@${pkg.version}`);
    }
    const { tools } = await withTimeout(client.listTools(), "tools/list");
    const names = tools.map((tool) => tool.name);
    if (!names.includes("jev_ask")) throw new Error(`jev_ask missing from tools/list: [${names.join(", ")}]`);
    const ms = Math.round(performance.now() - started);
    console.log(`smoke: ${server.name}@${server.version} via \`${shown}\` -> ${names.join(", ")} (${ms} ms)`);
  } catch (error) {
    const log = stderr.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(log ? `${message}\n--- server stderr ---\n${log}` : message, { cause: error });
  } finally {
    await client.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const [command = "bun", ...args] =
    argv.length > 0 ? argv : ["bun", join(import.meta.dir, "..", "..", "dist", "typesafe-mcp.js")];
  try {
    await smoke(command, args);
  } catch (error) {
    console.error(`smoke: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
