import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { certaintyOf, decide, thresholdsFrom } from "../gating.ts";
import { toNoulQuestion } from "../questions.ts";
import { ok } from "../result.ts";
import { checkInput, checkOutput } from "../schemas.ts";

export const CHECK_DESCRIPTION =
  "Ask Jev one yes/no question about `state` and get the probability (0–1) that the answer is yes. Jev returns structured decisions only and does not generate text or explanations. `decision` (act/review/abstain) is computed by this server from |probability−0.5|×2 against your thresholds; it is not Jev's opinion about whether you may proceed.";

export function registerCheck(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_check",
    {
      title: "Yes/no check (Noul)",
      description: CHECK_DESCRIPTION,
      inputSchema: checkInput,
      outputSchema: checkOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const noulInput = {
          question: input.question,
          ...(input.criteria ? { criteria: input.criteria } : {}),
        };
        const res = await client.systemOne({
          state: input.state,
          questions: { q: toNoulQuestion(noulInput) },
          ...(input.model ? { model: input.model } : {}),
        });
        const a = res.answers.q;
        const thresholds = thresholdsFrom({
          act_above: input.act_above,
          review_above: input.review_above,
        });
        const certainty = certaintyOf(a);
        return ok(
          checkOutput.parse({
            type: "noul",
            probability: a.noul,
            answer: a.noul >= 0.5,
            certainty,
            decision: decide(certainty, thresholds),
            thresholds,
            model: res.model,
            usage: res.usage,
          }),
        );
      } catch (e) {
        return toToolError(e, { tool: "jev_check" });
      }
    },
  );
}
