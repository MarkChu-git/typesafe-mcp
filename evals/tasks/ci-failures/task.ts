import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { itemAccuracy, normLabel, normPath } from "../../verifiers.ts";

const failureSchema = z.object({
  folder: z.string(),
  cause: z.enum(["pr", "flaky", "environment"]),
});

const answerSchema = z.object({
  failures: z.array(failureSchema),
});

type AnswerType = z.infer<typeof answerSchema>;

/** Folder name without the test-results/ prefix, whatever slash or letter case the answer used. */
function folderKey(folder: string): string {
  return normLabel(normPath(folder)).replace(/^test-results\//, "");
}

function causeByFolder(failures: AnswerType["failures"]): Record<string, string> {
  const causes: Record<string, string> = {};
  for (const failure of failures) {
    causes[folderKey(failure.folder)] = failure.cause;
  }
  return causes;
}

export default defineTask({
  id: "ci-failures",
  title: "Why Did CI Fail",
  category: "triage",
  split: "dev",
  dir: import.meta.dir,
  prompt: `CI is red on PR #519 (PR.md has the description). For each failed test I need to know whether this PR caused it, whether it is one of the known flaky problems, or whether the CI environment was broken. The e2e run left one folder per failed test under test-results/. Each folder has an error-context.md with the error, the test's steps and whatever the page or the servers printed. KNOWN_FLAKES.md lists the flaky problems we already track, and ci/run-7731.md is the CI job summary.

Give each failed test one cause:
- pr: a change that PR.md describes is what breaks the test.
- flaky: the failure shows one of the symptoms of a problem in KNOWN_FLAKES.md.
- environment: the output the test captured shows that a CI service or secret named in ci/run-7731.md was broken.

Use the folder name, without the test-results/ prefix, as the test's id, and include every failed test once.

Return your final answer as structured output.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const predicted = causeByFolder(answer.failures);
    const expected = causeByFolder(gold.failures);

    const accuracy = itemAccuracy(predicted, expected);
    const wrong = Object.keys(expected)
      .filter((folder) => predicted[folder] !== expected[folder])
      .toSorted();

    return { score: accuracy, passed: accuracy >= 0.8, details: { accuracy, wrong } };
  },
});
