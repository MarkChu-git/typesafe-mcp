import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { thresholdsFrom, withDecision } from "../gating.ts";
import { toScoreQuestion } from "../questions.ts";
import { ok } from "../result.ts";
import { scoreInput, scoreOutput } from "../schemas.ts";

export const SCORE_DESCRIPTION =
  "Ask Jev to rate `state` on an ordered rubric you define (2–10 levels, index 0 first). Returns the probability-weighted score (may fall between levels), the legend, the per-level distribution and confidence. Use the score to compare against a threshold, not to reconstruct exact numbers. Jev does not generate text; `decision` is computed by this server from `confidence`.";

export function registerScore(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_score",
    {
      title: "Rubric score (Score)",
      description: SCORE_DESCRIPTION,
      inputSchema: scoreInput,
      outputSchema: scoreOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const res = await client.systemOne({
          state: input.state,
          questions: {
            q: toScoreQuestion({ question: input.question, levels: input.levels }),
          },
          ...(input.model ? { model: input.model } : {}),
        });
        const thresholds = thresholdsFrom({
          act_above: input.act_above,
          review_above: input.review_above,
        });
        return ok(
          scoreOutput.parse({
            ...withDecision(res.answers.q, thresholds),
            model: res.model,
            usage: res.usage,
          }),
        );
      } catch (e) {
        return toToolError(e, { tool: "jev_score" });
      }
    },
  );
}
