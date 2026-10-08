import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { setF1 } from "../../verifiers.ts";

const answerSchema = z.object({
  customers: z.array(z.string()),
});

type AnswerType = z.infer<typeof answerSchema>;

export default defineTask({
  id: "payment-log-duplicates",
  title: "Payment Log Duplicate Detection",
  category: "control",
  split: "dev",
  dir: import.meta.dir,
  prompt: `You are an operations analyst. Your task is to review a payment processing log and identify customers who have been charged more than once for the same order.

The log file payments.log contains one event per line:
\`ISO_TIMESTAMP EVENT_TYPE customer=<id> order=<id> charge=<id> amount=<n> currency=<code> idempotency_key=<key>\`
(\`-\` marks a field that does not apply.)

Event types include: charge.succeeded, charge.failed, refund.created, payout.paid, dispute.created, etc.

A customer is considered "affected" when:
- Two or more different charge ids have a "charge.succeeded" event for the SAME order ID

Do NOT count:
- charge.failed events (these are not actual charges)
- The same charge id logged more than once (a duplicated log line, not a second charge)
- A failed charge followed by a successful retry (this is normal recovery)
- The same customer with different order IDs (this is normal for repeat customers)
- Refunds or other non-charge events

Review the entire log carefully and list all affected customer IDs.

Return your final answer as structured output with customer IDs sorted alphabetically.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    return {
      score: setF1(answer.customers, gold.customers).f1,
      passed: setF1(answer.customers, gold.customers).f1 >= 0.9,
    };
  },
});
