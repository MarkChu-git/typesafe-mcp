import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { thresholdsFrom, withDecision } from "../gating.ts";
import { buildQuestions } from "../questions.ts";
import { ok } from "../result.ts";
import { askInput, askOutput } from "../schemas.ts";

export const ASK_DESCRIPTION =
  "Ask Jev several questions (noul / choice / score, mixed) about the SAME state in ONE request. Use this instead of multiple jev_* calls: one request is roughly 10x cheaper and faster and gives identical answers. Each answer carries its own probability/confidence and a server-computed decision. Jev does not generate text.";

export function registerAsk(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_ask",
    {
      title: "Batch questions (mixed)",
      description: ASK_DESCRIPTION,
      inputSchema: askInput,
      outputSchema: askOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const res = await client.systemOne({
          state: input.state,
          questions: buildQuestions(input.questions),
          ...(input.model ? { model: input.model } : {}),
        });
        const thresholds = thresholdsFrom({
          act_above: input.act_above,
          review_above: input.review_above,
        });
        const answers = Object.fromEntries(
          Object.entries(res.answers).map(([id, a]) => [id, withDecision(a, thresholds)]),
        );
        return ok(
          askOutput.parse({
            answers,
            model: res.model,
            usage: res.usage,
          }),
        );
      } catch (e) {
        return toToolError(e, { tool: "jev_ask" });
      }
    },
  );
}
