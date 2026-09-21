#!/usr/bin/env bun
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.ts";

process.on("uncaughtException", (e) => {
  console.error("[typesafe-mcp] fatal:", e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error("[typesafe-mcp] unhandled:", e);
});

serveStdio(() => createServer());
