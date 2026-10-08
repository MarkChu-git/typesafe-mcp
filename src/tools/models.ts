import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { readConfig } from "../config.ts";
import { toToolError } from "../errors.ts";
import { ok } from "../result.ts";
import { modelsInput, modelsOutput } from "../schemas.ts";

export const MODELS_DESCRIPTION =
  "List the Jev models available to this account and the server's default model. Uses no inference tokens. Jev does not generate text.";

export function registerModels(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_models",
    {
      title: "List Jev models",
      description: MODELS_DESCRIPTION,
      inputSchema: modelsInput,
      outputSchema: modelsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const client = getClient(deps);
        const models = await client.models.list();
        return ok(
          modelsOutput.parse({
            models,
            default_model: readConfig(deps.env).defaultModel,
          }),
        );
      } catch (e) {
        return toToolError(e, { tool: "jev_models" });
      }
    },
  );
}
