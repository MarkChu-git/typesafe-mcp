import { McpServer } from "@modelcontextprotocol/server";
import type { ClientDeps } from "./client.ts";
import { SERVER_NAME, SERVER_VERSION } from "./config.ts";
import { registerCheck } from "./tools/check.ts";
import { registerModels } from "./tools/models.ts";

export function createServer(deps: ClientDeps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerModels(server, deps);
  registerCheck(server, deps);
  return server;
}
