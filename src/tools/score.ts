import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { ANSWER_NOTE, thresholdsFrom, toAnswer } from "../gating.ts";
import { toScoreQuestion, toState } from "../questions.ts";
import { ok } from "../result.ts";
import { scoreInput, scoreOutput } from "../schemas.ts";

export const SCORE_DESCRIPTION = `Ask Jev, TypeSafe's decision model, to rate state on ordered levels; \`answer\` is the expected level index and may fall between levels. ${ANSWER_NOTE}`;

export function registerScore(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_score",
    {
      title: "Rubric score",
      description: SCORE_DESCRIPTION,
      inputSchema: scoreInput,
      outputSchema: scoreOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const res = await client.systemOne({
          state: toState(input.state),
          questions: { q: toScoreQuestion(input) },
          ...(input.model ? { model: input.model } : {}),
        });
        const thresholds = thresholdsFrom(input);
        return ok(scoreOutput.parse(toAnswer(res.answers.q, thresholds, input.detailed)), {
          model: res.model,
          usage: res.usage,
          thresholds,
        });
      } catch (e) {
        return toToolError(e, { tool: "jev_score" });
      }
    },
  );
}
