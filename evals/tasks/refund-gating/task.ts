import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { weightedCost } from "../../verifiers.ts";

const requestSchema = z.object({
  id: z.string(),
  decision: z.enum(["auto_approve", "human_review", "deny"]),
});

const answerSchema = z.object({
  decisions: z.array(requestSchema),
});

type AnswerType = z.infer<typeof answerSchema>;

/** gold → predicted → cost. Mirrored by evals/laws/scoring.bend, whose laws are proven. */
export const REFUND_COST = {
  auto_approve: { auto_approve: 0, human_review: 1, deny: 2 },
  human_review: { auto_approve: 5, human_review: 0, deny: 2 },
  deny: { auto_approve: 5, human_review: 1, deny: 0 },
} as const;

export default defineTask({
  id: "refund-gating",
  title: "Refund Request Gating",
  category: "gating",
  split: "dev",
  dir: import.meta.dir,
  prompt: `You are a refund specialist. Your task is to review refund requests and apply the company policy to classify each one as auto_approve, human_review, or deny.

The refund policy is in policy.md. Read it carefully to understand all the decision criteria. Pay attention to:
- Time windows (30 days, 90 days)
- Amount thresholds ($100)
- Prior refund history
- Excluded item categories
- Currency handling
- Edge cases and ambiguities

For each refund request in the requests/ directory, carefully evaluate it against the policy criteria and determine the appropriate decision.

Files in requests/ contain customer messages describing why they want a refund, along with order facts (order date, delivery date, amount, item type, prior refunds).

Return your final answer as structured output.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const predById: Record<string, string> = {};
    for (const decision of answer.decisions) {
      predById[decision.id] = decision.decision;
    }

    const goldById: Record<string, string> = {};
    for (const decision of gold.decisions) {
      goldById[decision.id] = decision.decision;
    }

    const score = weightedCost(predById, goldById, REFUND_COST);
    return { score, passed: score >= 0.8 };
  },
});
