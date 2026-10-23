import { join } from "node:path";
import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { normLabel, normPath } from "../../verifiers.ts";
import { fileOf, HEIGHT, SCREENS, WIDTH } from "../screenshot-triage/generate.ts";

const boxSchema = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });

const answerSchema = z.object({
  problems: z.array(z.object({ file: z.string(), box: boxSchema })),
});

type AnswerType = z.infer<typeof answerSchema>;
type Box = z.infer<typeof boxSchema>;

/** How far a box's centre may fall outside the gold box, in pixels, and still point at the problem. */
const MARGIN = 16;

/** A page, whatever path prefix, slashes or letter case the answer used for its file. */
const pageOf = (file: string): string => normLabel(normPath(file)).replace(/^screenshots\//, "");

const area = (b: Box): number => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

/** Intersection over union: 1 when the boxes are the same, 0 when they do not overlap. */
function iou(a: Box, b: Box): number {
  const shared = area({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });
  return shared / (area(a) + area(b) - shared);
}

function pointsAt(b: Box, gold: Box): boolean {
  const x = (b.left + b.right) / 2;
  const y = (b.top + b.bottom) / 2;
  return x >= gold.left - MARGIN && x <= gold.right + MARGIN && y >= gold.top - MARGIN && y <= gold.bottom + MARGIN;
}

const BROKEN = SCREENS.flatMap((s) => (s.problem ? [`- ${fileOf(s.name)}: ${s.problem}`] : []))
  .toSorted()
  .join("\n");

export default defineTask({
  id: "screenshot-locate",
  title: "Where Each Page Broke",
  category: "retrieval",
  split: "dev",
  dir: import.meta.dir,
  // The screenshots of screenshot-triage; the prompt names the pages that broke and how.
  workspace: join(import.meta.dir, "..", "screenshot-triage", "workspace"),
  // Jev can only look at the screenshots when the server sends images.
  serverEnv: { TYPESAFE_IMAGES: "1" },
  prompt: `Last night's visual check of our storefront saved one screenshot of every page it visited in screenshots/, each ${WIDTH}×${HEIGHT} pixels. These pages broke:

${BROKEN}

For each of them, show me where on the screenshot the problem is: a box in pixels, with left, top, right and bottom measured from the top-left corner. Box the problem itself:

- error: the error alert or toast, the field that failed together with its error message, or the error page's code, message and button.
- loading: the spinner with its loading message, or the grey placeholder blocks where the content should be.

List each page once, as screenshots/<name>.png.

Return your final answer as structured output.`,
  answer: answerSchema,
  // A page counts as located when its first box is a box whose centre points at the problem.
  score(answer: AnswerType, gold: AnswerType) {
    const given = new Map<string, Box>();
    for (const { file, box } of answer.problems) if (!given.has(pageOf(file))) given.set(pageOf(file), box);
    let located = 0;
    let overlap = 0;
    for (const { file, box } of gold.problems) {
      const b = given.get(pageOf(file));
      if (!b || b.left >= b.right || b.top >= b.bottom) continue;
      if (pointsAt(b, box)) located += 1;
      overlap += iou(b, box);
    }
    const of = gold.problems.length;
    return { score: located / of, passed: located / of >= 0.8, details: { located, of, iou: overlap / of } };
  },
});
