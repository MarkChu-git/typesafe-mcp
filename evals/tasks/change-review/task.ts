import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { normPath, setF1 } from "../../verifiers.ts";

const violationSchema = z.object({
  file: z.string(),
  rule: z.number(),
});

const answerSchema = z.object({
  violations: z.array(violationSchema),
});

type AnswerType = z.infer<typeof answerSchema>;
type ViolationType = z.infer<typeof violationSchema>;

/** One scored item: the file (path-normalized) and the rule number it breaks. */
const pairKey = (violation: ViolationType): string => `${normPath(violation.file)}#${violation.rule}`;

export default defineTask({
  id: "change-review",
  title: "Review a PR Against Team Rules",
  category: "verification",
  split: "dev",
  dir: import.meta.dir,
  prompt: `A teammate asked you to review pull request #482 before it is merged.

PR.md has the description and the list of changed files, and CONVENTIONS.md has the team's six rules. Check each changed file against those rules and list every violation as the file and the number of the rule it breaks. The workspace holds the code as it will be after the merge, so read each changed file as it stands. A file can break more than one rule, and several files can break the same rule. Only the files listed in PR.md count: the rest of the repository is not part of this review, even where it has similar problems.

Return your final answer as structured output: one entry per violation, with the file path relative to the workspace root and the rule number from CONVENTIONS.md. Name a file once for each rule it breaks.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const { f1, precision, recall } = setF1(answer.violations.map(pairKey), gold.violations.map(pairKey));
    return { score: f1, passed: f1 >= 0.8, details: { precision, recall } };
  },
});
