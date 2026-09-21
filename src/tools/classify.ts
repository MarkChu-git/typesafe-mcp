import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { thresholdsFrom, withDecision } from "../gating.ts";
import { toChoiceQuestion } from "../questions.ts";
import { ok } from "../result.ts";
import { classifyInput, classifyOutput } from "../schemas.ts";

export const CLASSIFY_DESCRIPTION =
  "Ask Jev to pick exactly one option from a closed set you define (2–255 labels), given `state`. Returns the chosen label, the full probability distribution and Jev's confidence (0–1, derived from how concentrated the distribution is). Jev never invents new labels and does not generate text. `decision` is computed by this server from `confidence` against your thresholds.";

export function registerClassify(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_classify",
    {
      title: "Closed-set classification (Choice)",
      description: CLASSIFY_DESCRIPTION,
      inputSchema: classifyInput,
      outputSchema: classifyOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const res = await client.systemOne({
          state: input.state,
          questions: {
            q: toChoiceQuestion({ question: input.question, options: input.options }),
          },
          ...(input.model ? { model: input.model } : {}),
        });
        const thresholds = thresholdsFrom({
          act_above: input.act_above,
          review_above: input.review_above,
        });
        return ok(
          classifyOutput.parse({
            ...withDecision(res.answers.q, thresholds),
            model: res.model,
            usage: res.usage,
          }),
        );
      } catch (e) {
        return toToolError(e, { tool: "jev_classify" });
      }
    },
  );
}
