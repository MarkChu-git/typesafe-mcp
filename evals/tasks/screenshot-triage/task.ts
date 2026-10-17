import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { normLabel, normPath, setF1 } from "../../verifiers.ts";

const answerSchema = z.object({
  broken: z.array(
    z.object({
      file: z.string(),
      problem: z.enum(["error", "loading"]),
    }),
  ),
});

type AnswerType = z.infer<typeof answerSchema>;

/** A page and its problem, whatever path prefix, slashes or letter case the answer used for the file. */
const pairs = (broken: AnswerType["broken"]): string[] =>
  broken.map(({ file, problem }) => `${normLabel(normPath(file)).replace(/^screenshots\//, "")} ${problem}`);

export default defineTask({
  id: "screenshot-triage",
  title: "Which Pages Broke",
  category: "triage",
  split: "dev",
  dir: import.meta.dir,
  // Jev can only look at the screenshots when the server sends images.
  serverEnv: { TYPESAFE_IMAGES: "1" },
  prompt: `Last night's visual check of our storefront saved one screenshot of every page it visited in screenshots/. Some pages broke, and I need to know which ones and how:

- error: the page shows an error message: an error banner or alert, a field or action that failed, or an error page in place of the content.
- loading: the page never finished loading: where its content should be there is only a spinner, grey placeholder blocks or a loading message.

A page that looks the way it should is fine, even with red sale badges, a green confirmation, an empty list that says so, or a help article about errors. List every broken page once, as screenshots/<name>.png, with its problem.

Return your final answer as structured output.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const { precision, recall, f1 } = setF1(pairs(answer.broken), pairs(gold.broken));
    return { score: f1, passed: f1 >= 0.8, details: { precision, recall } };
  },
});
