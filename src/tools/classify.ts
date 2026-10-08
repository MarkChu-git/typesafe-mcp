import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { ANSWER_NOTE, thresholdsFrom, toAnswer } from "../gating.ts";
import { toChoiceQuestion, toState } from "../questions.ts";
import { ok } from "../result.ts";
import { classifyInput, classifyOutput } from "../schemas.ts";

export const CLASSIFY_DESCRIPTION = `Ask Jev, TypeSafe's decision model, to pick exactly one label from options for state; \`answer\` is the label. ${ANSWER_NOTE}`;

export function registerClassify(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_classify",
    {
      title: "Pick one label",
      description: CLASSIFY_DESCRIPTION,
      inputSchema: classifyInput,
      outputSchema: classifyOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const res = await client.systemOne({
          state: toState(input.state),
          questions: { q: toChoiceQuestion(input) },
          ...(input.model ? { model: input.model } : {}),
        });
        const thresholds = thresholdsFrom(input);
        return ok(classifyOutput.parse(toAnswer(res.answers.q, thresholds, input.detailed)), {
          model: res.model,
          usage: res.usage,
          thresholds,
        });
      } catch (e) {
        return toToolError(e, { tool: "jev_classify" });
      }
    },
  );
}
