import { join } from "node:path";
import type * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { HEIGHT, WIDTH } from "../screenshot-triage/generate.ts";
import { answerSchema, locate } from "../screenshot-locate/task.ts";

type AnswerType = z.infer<typeof answerSchema>;

export default defineTask({
  id: "screenshot-find",
  title: "Which Pages Broke and Where",
  category: "triage",
  split: "dev",
  dir: import.meta.dir,
  // screenshot-locate's task without the list of broken pages: the agent has to tell them from the fine ones.
  workspace: join(import.meta.dir, "..", "screenshot-triage", "workspace"),
  goldFile: join(import.meta.dir, "..", "screenshot-locate", "gold.json"),
  // Jev can only look at the screenshots when the server sends images.
  serverEnv: { TYPESAFE_IMAGES: "1" },
  prompt: `Last night's visual check of our storefront saved one screenshot of every page it visited in screenshots/, each ${WIDTH}×${HEIGHT} pixels. Some pages broke:

- error: the page shows an error message: an error banner or alert, a field or action that failed, or an error page in place of the content.
- loading: the page never finished loading: where its content should be there is only a spinner, grey placeholder blocks or a loading message.

A page that looks the way it should is fine, even with red sale badges, a green confirmation, an empty list that says so, or a help article about errors.

For each broken page, show me where on the screenshot the problem is: a box in pixels, with left, top, right and bottom measured from the top-left corner. Box the problem itself:

- error: the error alert or toast, the field that failed together with its error message, or the error page's code, message and button.
- loading: the spinner with its loading message, or the grey placeholder blocks where the content should be.

List every broken page once, as screenshots/<name>.png, and leave out the pages that are fine.

Return your final answer as structured output.`,
  answer: answerSchema,
  // Out of the broken pages plus every fine page the answer boxed, so boxing all 40 does not pay.
  score(answer: AnswerType, gold: AnswerType) {
    const { located, iou, extra } = locate(answer, gold);
    const of = gold.problems.length;
    const score = located / (of + extra);
    return { score, passed: score >= 0.8, details: { located, of, extra, iou } };
  },
});
