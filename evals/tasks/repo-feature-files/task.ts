import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { normPath, setF1 } from "../../verifiers.ts";

const answerSchema = z.object({
  files: z.array(z.string()),
});

type AnswerType = z.infer<typeof answerSchema>;

export default defineTask({
  id: "repo-feature-files",
  title: "Feature Implementation Files",
  category: "retrieval",
  split: "dev",
  dir: import.meta.dir,
  prompt: `You are a code reviewer analyzing a TypeScript e-commerce service. Your task is to identify which source files implement the refund processing workflow.

The refund flow includes these stages:
1. Creating refund requests
2. Validating refunds against policy
3. Executing the refund (processing the payment reversal)
4. Recording the refund in the system

You should include files that contain core logic for these stages. Do NOT include:
- Documentation files (even if they mention refunds)
- UI translation/i18n files mentioning refunds
- Seed/fixture/test data files
- Dead code marked as unused or deprecated
- Files that only mention refunds in passing (comments, log statements, UI strings)
- Payment processing files that only reference refunds in comments

The workspace contains a small service repository. Examine the code to find the actual implementation files.

Return your final answer as structured output with file paths relative to the workspace root.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const { f1 } = setF1(answer.files, gold.files, normPath);
    return { score: f1, passed: f1 >= 0.8 };
  },
});
