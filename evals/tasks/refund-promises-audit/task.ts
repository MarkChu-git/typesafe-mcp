import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { itemAccuracy, normLabel, setF1 } from "../../verifiers.ts";

const violationSchema = z.object({
  ticket: z.string(),
  agent: z.string(),
  amount: z.number(),
  team_lead: z.string(),
  issued: z.boolean(),
});

const answerSchema = z.object({
  violations: z.array(violationSchema),
  total_by_lead: z.array(z.object({ team_lead: z.string(), amount: z.number() })),
});

type AnswerType = z.infer<typeof answerSchema>;
type ViolationType = z.infer<typeof violationSchema>;

const CENT_TOLERANCE = 0.01 + 1e-9;

const closeCents = (a: number, b: number): boolean => Math.abs(a - b) <= CENT_TOLERANCE;

/** Share of the four scored fields (agent, amount, team_lead, issued) the prediction gets right. */
function fieldScore(pred: ViolationType | undefined, gold: ViolationType): number {
  if (pred === undefined) return 0;
  const hits = [
    normLabel(pred.agent) === normLabel(gold.agent),
    closeCents(pred.amount, gold.amount),
    normLabel(pred.team_lead) === normLabel(gold.team_lead),
    pred.issued === gold.issued,
  ];
  return hits.filter(Boolean).length / hits.length;
}

/** Predicted violations keyed by normalized ticket; the first entry wins if a ticket repeats. */
function byTicket(violations: readonly ViolationType[]): Map<string, ViolationType> {
  const map = new Map<string, ViolationType>();
  for (const violation of violations) {
    const key = normLabel(violation.ticket);
    if (!map.has(key)) map.set(key, violation);
  }
  return map;
}

export default defineTask({
  id: "refund-promises-audit",
  title: "Refund Promise Audit",
  category: "verification",
  split: "dev",
  dir: import.meta.dir,
  prompt: `You are auditing support conversations for compliance with the refund policy in policy.md.

The 100 conversations are in transcripts/. Agent assignments are in staff.csv. Refunds that were actually issued are in ledger/refunds-2026-09.csv.

1. Find every conversation where the support agent promised the customer money back (a refund, a credit back, a charge reversal, however it is worded) of more than $200 without a supervisor approval recorded in that conversation.
2. For each one, report the ticket id, the agent's name, the promised amount in dollars, the agent's team lead from staff.csv, and whether the ledger has a refund for that ticket.
3. Total the promised amounts of these conversations per team lead.

Return your final answer as structured output.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const f1 = setF1(
      answer.violations.map((v) => v.ticket),
      gold.violations.map((v) => v.ticket),
    ).f1;

    const predicted = byTicket(answer.violations);
    const detail =
      gold.violations.length === 0
        ? 1
        : gold.violations.reduce((sum, g) => sum + fieldScore(predicted.get(normLabel(g.ticket)), g), 0) /
          gold.violations.length;

    const predTotals = Object.fromEntries(answer.total_by_lead.map((t) => [normLabel(t.team_lead), t.amount]));
    const goldTotals = Object.fromEntries(gold.total_by_lead.map((t) => [normLabel(t.team_lead), t.amount]));
    const totals = itemAccuracy(predTotals, goldTotals, closeCents);

    const score = Math.min(1, Math.max(0, 0.5 * f1 + 0.35 * detail + 0.15 * totals));
    return { score, passed: score >= 0.9, details: { f1, detail, totals } };
  },
});
