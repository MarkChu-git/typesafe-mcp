import { McpServer } from "@modelcontextprotocol/server";
import type { ClientDeps } from "./client.ts";
import { ENV, readConfig, SERVER_NAME, SERVER_VERSION, type ToolName } from "./config.ts";
import { registerAsk } from "./tools/ask.ts";
import { registerCheck } from "./tools/check.ts";
import { registerClassify } from "./tools/classify.ts";
import { registerModels } from "./tools/models.ts";
import { registerScore } from "./tools/score.ts";

const REGISTER: Record<ToolName, (server: McpServer, deps: ClientDeps) => void> = {
  jev_ask: registerAsk,
  jev_check: registerCheck,
  jev_classify: registerClassify,
  jev_score: registerScore,
  jev_models: registerModels,
};

/** Registers the tools named by `TYPESAFE_TOOLS` (default: `jev_ask` only). */
export function createServer(deps: ClientDeps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const { tools, unknownTools } = readConfig(deps.env);
  if (unknownTools.length > 0) {
    console.error(`[typesafe-mcp] ${ENV.tools}: ignoring unknown tools ${unknownTools.join(", ")}`);
  }
  for (const name of tools) REGISTER[name](server, deps);
  return server;
}
