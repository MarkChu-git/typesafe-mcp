import type { McpServer } from "@modelcontextprotocol/server";
import { getClient, type ClientDeps } from "../client.ts";
import { toToolError } from "../errors.ts";
import { ANSWER_NOTE, thresholdsFrom, toAnswer } from "../gating.ts";
import { toNoulQuestion, toState } from "../questions.ts";
import { ok } from "../result.ts";
import { checkInput, checkOutput } from "../schemas.ts";

export const CHECK_DESCRIPTION = `Ask Jev, TypeSafe's decision model, one yes/no question about state; \`answer\` is true or false. ${ANSWER_NOTE}`;

export function registerCheck(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_check",
    {
      title: "Yes/no check",
      description: CHECK_DESCRIPTION,
      inputSchema: checkInput,
      outputSchema: checkOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const client = getClient(deps);
        const res = await client.systemOne({
          state: toState(input.state),
          questions: { q: toNoulQuestion(input) },
          ...(input.model ? { model: input.model } : {}),
        });
        const thresholds = thresholdsFrom(input);
        return ok(checkOutput.parse(toAnswer(res.answers.q, thresholds, input.detailed)), {
          model: res.model,
          usage: res.usage,
          thresholds,
        });
      } catch (e) {
        return toToolError(e, { tool: "jev_check" });
      }
    },
  );
}
