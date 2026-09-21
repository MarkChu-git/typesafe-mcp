import { McpServer } from "@modelcontextprotocol/server";
import type { ClientDeps } from "./client.ts";
import { SERVER_NAME, SERVER_VERSION } from "./config.ts";
import { registerAsk } from "./tools/ask.ts";
import { registerCheck } from "./tools/check.ts";
import { registerClassify } from "./tools/classify.ts";
import { registerModels } from "./tools/models.ts";
import { registerScore } from "./tools/score.ts";

export function createServer(deps: ClientDeps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerModels(server, deps);
  registerCheck(server, deps);
  registerClassify(server, deps);
  registerScore(server, deps);
  registerAsk(server, deps);
  return server;
}
