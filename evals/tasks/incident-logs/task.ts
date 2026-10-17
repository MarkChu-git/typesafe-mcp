import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { setF1 } from "../../verifiers.ts";

const answerSchema = z.object({
  ids: z.array(z.string()),
});

type AnswerType = z.infer<typeof answerSchema>;

export default defineTask({
  id: "incident-logs",
  title: "Log Entries Behind an Incident",
  category: "retrieval",
  split: "dev",
  dir: import.meta.dir,
  prompt: `Hi, could you help me with last night's checkout outage? The on-call note is in INCIDENT.md. The API log for that night is logs/api-2026-10-11.jsonl, one JSON object per line, and logs/FIELDS.md explains the fields.

We still don't know why it happened. I need the ids of every entry that belongs to this incident:

- Checkout requests (routes under /v1/checkout) that hung: they timed out, the client gave up on them, or they never got what they were waiting for. Shoppers retrying checkout count too.
- Whatever those requests were stuck behind: the entries that show the cause, wherever in the log it shows up, from when it began until it was cleared.

Leave out health checks, configuration notices, requests that failed fast with a 4xx response, requests that completed normally, and problems that have nothing to do with the stuck checkouts.

Return your final answer as structured output. Give each id as a plain string, such as e0123.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const { precision, recall, f1 } = setF1(answer.ids, gold.ids);
    return { score: f1, passed: f1 >= 0.8, details: { precision, recall } };
  },
});
