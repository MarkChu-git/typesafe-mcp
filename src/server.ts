import { McpServer } from "@modelcontextprotocol/server";
import type { ClientDeps } from "./client.ts";
import { ENV, readConfig, SERVER_NAME, SERVER_VERSION, type ToolName } from "./config.ts";
import { askInstructions, registerAsk } from "./tools/ask.ts";
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

/** Registers the tools named by `TYPESAFE_TOOLS` (default: `jev_ask` only), with instructions when `jev_ask` is one. */
export function createServer(deps: ClientDeps = {}): McpServer {
  const { tools, unknownTools, images } = readConfig(deps.env);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    tools.includes("jev_ask") ? { instructions: askInstructions(images) } : {},
  );
  if (unknownTools.length > 0) {
    console.error(`[typesafe-mcp] ${ENV.tools}: ignoring unknown tools ${unknownTools.join(", ")}`);
  }
  for (const name of tools) REGISTER[name](server, deps);
  return server;
}
