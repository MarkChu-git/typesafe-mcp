import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { normPath } from "../../verifiers.ts";

const answerSchema = z.object({
  files: z.array(z.string()),
});

type AnswerType = z.infer<typeof answerSchema>;

/**
 * The gold lists every file with a defect on the way to the first charge. A fix can route around the trial and
 * term-length defects by reading the term the subscription already holds, so only the conversion job has to be
 * named; naming the other two is not counted wrong, and any other file is.
 */
const REQUIRED = new Set(["src/jobs/convertTrials.ts"]);

export default defineTask({
  id: "bug-files",
  title: "Files Behind a Billing Bug",
  category: "retrieval",
  split: "dev",
  dir: import.meta.dir,
  prompt: `Support escalated a billing bug and I'm about to pick it up. Customers who choose yearly billing when they start a free trial are charged the monthly price when the trial converts to a paid subscription. Their renewals after that charge the right yearly price, and customers who skip the trial and subscribe directly are billed correctly.

Before I start, can you tell me which source files the fix will need to change? A file counts if its logic has to be corrected before a yearly trial customer is charged the yearly price on that first paid charge. Files that only mention trials, yearly plans or prices but work correctly don't count, and neither do docs, config, sample data or code that nothing runs any more.

Please don't change anything yet. Return your final answer as structured output: \`files\` is the list of file paths, relative to the workspace root.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const named = new Set(answer.files.map(normPath));
    const allowed = new Set(gold.files.map(normPath));
    const required = [...allowed].filter((file) => REQUIRED.has(file));
    const precision = named.size === 0 ? 0 : [...named].filter((file) => allowed.has(file)).length / named.size;
    const recall = required.length === 0 ? 1 : required.filter((file) => named.has(file)).length / required.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { score: f1, passed: f1 >= 0.8, details: { precision, recall } };
  },
});
