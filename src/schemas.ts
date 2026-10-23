import * as z from "zod/v4";
import { ENV } from "./config.ts";

// Input schemas become the tool definitions an agent reads on every model call, so descriptions
// live in one place (the tool description or a single field) and nested values stay untyped.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const stateSchema = z
  .union([z.string().min(1), z.looseObject({}), z.array(z.unknown()).min(1)])
  .describe(
    "What Jev judges: text, a JSON object or a JSON array; use named fields when it has several parts. Send only what the questions need; extra detail lowers accuracy. Max ~32k tokens.",
  );

export const questionSchema = z.string().min(1);

export const criteriaSchema = z
  .strictObject({ true: z.string().min(1).optional(), false: z.string().min(1).optional() })
  .describe("What yes and no mean.");

export const optionsSchema = z
  .record(z.string(), z.string().nullable())
  .refine((o) => Object.keys(o).length >= 2, "at least 2 options are required")
  .refine((o) => Object.keys(o).length <= 255, "at most 255 options are allowed")
  .describe("Label → rubric or null, 2–255 labels. Jev picks exactly one.");

export const levelsSchema = z
  .array(z.string().nullable())
  .min(2)
  .max(10)
  .describe("Rubric per level, index 0 first, 2–10 levels.");

export const detailedField = z.boolean().optional().describe("Also return probabilities.");
export const modelField = z.string().min(1).optional().describe("Jev model id; default from server config.");

export const thresholdsFields = {
  act_above: z.number().min(0).max(1).optional(),
  review_above: z.number().min(0).max(1).optional(),
};

export const refineThresholds = (
  v: { act_above?: number | undefined; review_above?: number | undefined },
  ctx: z.RefinementCtx,
): void => {
  const act = v.act_above ?? 0.8;
  const rev = v.review_above ?? 0.5;
  if (rev > act) {
    ctx.addIssue({
      code: "custom",
      path: ["review_above"],
      message: "review_above must not exceed act_above",
    });
  }
};

/** Shared tail of every question tool's input. */
const commonFields = { detailed: detailedField, model: modelField, ...thresholdsFields };

export const QUESTION_TYPES = ["noul", "choice", "score"] as const;
/** With `TYPESAFE_IMAGES` on, also `box`, which needs an image. */
const IMAGE_QUESTION_TYPES = [...QUESTION_TYPES, "box"] as const;
type QuestionType = (typeof IMAGE_QUESTION_TYPES)[number];

/** The field each type requires; the other type-specific fields are rejected, and a box takes none of them. */
const TYPE_FIELD: Record<QuestionType, "criteria" | "options" | "levels" | undefined> = {
  noul: "criteria",
  choice: "options",
  score: "levels",
  box: undefined,
};
const FIELDS = ["criteria", "options", "levels"] as const;
const REQUIRED = new Set(["options", "levels"]);

const TYPE_HELP = "noul: yes/no; one per label when several can apply. choice: pick one key of options. score: rate on levels.";

/** zod would list the types it takes; a box asked with images off gets the switch that turns them on instead. */
const boxNeedsImages = (issue: { input?: unknown }): string | undefined =>
  issue.input === "box" ? `box needs images: set ${ENV.images}=1 in the server env` : undefined;

/** One flat object instead of a union, so the agent reads `question` and its guidance once. */
const askQuestionOf = (types: readonly [QuestionType, ...QuestionType[]], help: string) =>
  z
    .strictObject({
      type: z.enum(types, { error: boxNeedsImages }).describe(help),
      question: questionSchema,
      options: optionsSchema
        .optional()
        .describe("choice only. Label → rubric or null, 2–255 labels. Add a none label if nothing may fit."),
      levels: levelsSchema.optional().describe("score only. Rubric per level, index 0 first, 2–10 levels."),
      criteria: criteriaSchema.optional().describe("noul only. What yes and no mean."),
    })
    .superRefine((q, ctx) => {
      for (const field of FIELDS) {
        const own = TYPE_FIELD[q.type] === field;
        const present = q[field] !== undefined;
        if (own && !present && REQUIRED.has(field)) {
          ctx.addIssue({ code: "custom", path: [field], message: `required when type is ${q.type}` });
        } else if (!own && present) {
          ctx.addIssue({ code: "custom", path: [field], message: `not used when type is ${q.type}` });
        }
      }
    });

export const askQuestionSchema = askQuestionOf(QUESTION_TYPES, TYPE_HELP);
/** Only sessions with images on read `box` in the tool definition, so the others pay no tokens for it. */
const askImageQuestionSchema = askQuestionOf(IMAGE_QUESTION_TYPES, `${TYPE_HELP} box: locate it in the image.`);

export const decisionSchema = z.enum(["act", "review", "abstain"]);

export const filesSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(20)])
  .describe(
    "Instead of state: glob(s) relative to the project root, e.g. tickets/*.md. The server reads the files, so nothing is copied. One Jev request per file or record; max 100 files, 500 records.",
  );

export const contextSchema = z
  .union([z.string().min(1), z.looseObject({})])
  .describe("With files: shared context sent with every file, e.g. the policy to apply.");

export const ITEM_MODES = ["file", "lines", "jsonl", "json", "csv", "sections"] as const;
export type ItemsMode = (typeof ITEM_MODES)[number];

export const itemsSchema = z
  .enum(ITEM_MODES)
  .describe(
    "With files: split each file into records judged one by one: lines, jsonl, json (array items), csv (rows), sections (Markdown headings). Default: whole file.",
  );

/** The `error` of a union is what the agent reads when none of its members fit; zod's default says only "Invalid input". */
const unionError = (expected: string) => ({ error: `expected ${expected}` });

const scalarSchema = z.union([z.boolean(), z.string()]);
/** A value to match, or a list of which any may match. */
const valueForms = [z.boolean(), z.string(), z.array(scalarSchema).min(1)] as const;

const conditionSchema = z
  .strictObject({
    is: z.union(valueForms, unionError("a boolean, a string or a list of them")).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    decision: z.union([decisionSchema, z.array(decisionSchema).min(1)], unionError("act, review, abstain or a list of them")).optional(),
  })
  .refine((c) => Object.keys(c).length > 0, "give at least one of is, min, max, decision");

/** A shorthand for `{ is }`, or a condition on the answer. */
const conditionValueSchema = z.union(
  [...valueForms, conditionSchema],
  unionError("true or false, a label, a list of them, or an object with is, min, max or decision"),
);
/** Question id → its condition; a record has to match every one. */
const conditionsSchema = z.record(z.string(), conditionValueSchema);
export type Conditions = z.infer<typeof conditionsSchema>;

/** The `where` key for objects of conditions a record has to match at least one of, as in "breaks any rule". */
export const ANY_OF = "$or";
const anyOfSchema = z
  .array(conditionsSchema, { error: "expected a list of objects of conditions" })
  .min(1, "give at least one object of conditions");
/** `where` as agents write it: conditions on question ids, plus `$or`. */
const whereShape = z.object({ [ANY_OF]: anyOfSchema.optional() }).catchall(conditionValueSchema);

/** `where` split for the filter: every condition in `all` holds, and with `$or`, every condition of one of `anyOf`. */
export interface Where {
  all: Conditions;
  anyOf?: Conditions[];
}

const topShape = z.strictObject({
  by: z.union([z.string().min(1), z.record(z.string(), z.number())], unionError("a question id or an object of id: weight")),
  k: z.number().int().min(1).max(100),
});
export type Top = z.infer<typeof topShape>;

/**
 * A field the tool definition shows as a plain object, its description naming the shape: spelling out
 * `where` and `top` as typed unions would cost every model call about 150 tokens. The refinement still
 * checks `shape`, so a malformed value fails as input validation.
 */
const describedObject = (shape: z.ZodType, description: string) =>
  z
    .looseObject({})
    .superRefine((value, ctx) => {
      const parsed = shape.safeParse(value);
      if (parsed.success) return;
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    })
    .describe(description);

export const whereSchema = describedObject(
  whereShape,
  `With files: keep records matching every condition, and with ${ANY_OF} at least one of its objects, e.g. {${ANY_OF}: [{r1: true}, {r2: true}]}. Left-out records lose all their answers and unsure text; skip where for a few dozen records or fewer. Per question id: a value or list (noul/choice), {min,max} (score), {decision}, or {is,min,max,decision} combined.`,
);

export const topSchema = describedObject(
  topShape,
  "With files: {by, k}. by is a score or noul id, or {id: weight} for a weighted sum; ranks by a score's level or a noul's p(yes) and returns the k best (k 1–100).",
);

/** `where` and `top` as `askInput` accepted them, typed; `where` splits `$or` off from the other conditions. */
export function parseWhere(where: Record<string, unknown>): Where {
  const { [ANY_OF]: anyOf, ...all } = where;
  return { all: conditionsSchema.parse(all), ...(anyOf === undefined ? {} : { anyOf: anyOfSchema.parse(anyOf) }) };
}
export const parseTop = (top: Record<string, unknown>): Top => topShape.parse(top);

export const countsSchema = z
  .boolean()
  .describe("With files: answer tallies over all records; without where or top, only the tallies are returned.");

/** What a `files` call adds to the question: how to split the files and which answers to keep. */
const FILES_ONLY = ["items", "where", "top", "counts"] as const;

const askInputOf = (question: typeof askQuestionSchema) =>
  z
    .strictObject({
      state: stateSchema.optional(),
      files: filesSchema.optional(),
      context: contextSchema.optional(),
      items: itemsSchema.optional(),
      where: whereSchema.optional(),
      top: topSchema.optional(),
      counts: countsSchema.optional(),
      questions: z
        .record(z.string(), question)
        .refine((q) => Object.keys(q).length >= 1, "at least one question is required")
        .describe("Your ids → questions. One request answers them all."),
      ...commonFields,
    })
    .superRefine((v, ctx) => {
      refineThresholds(v, ctx);
      if ((v.state === undefined) === (v.files === undefined)) {
        ctx.addIssue({ code: "custom", path: ["state"], message: "give exactly one of state or files" });
      }
      if (v.context !== undefined && v.files === undefined) {
        ctx.addIssue({ code: "custom", path: ["context"], message: "context is only used with files" });
      }
      const stray = FILES_ONLY.find((field) => v[field] !== undefined);
      if (stray !== undefined && v.files === undefined) {
        ctx.addIssue({ code: "custom", path: [stray], message: "items, where, top and counts are only used with files" });
      }
      // Only files reach Jev as images; state is text or JSON.
      if (v.state === undefined) return;
      for (const [id, q] of Object.entries(v.questions)) {
        if (q.type === "box") {
          ctx.addIssue({ code: "custom", path: ["questions", id], message: "box needs an image, so pass PNG or JPEG files in files instead of state" });
        }
      }
    });

export const askInput = askInputOf(askQuestionSchema);
/** `jev_ask`'s input with `TYPESAFE_IMAGES` on: questions may also be `box`. */
export const askImagesInput = askInputOf(askImageQuestionSchema);

export const checkInput = z
  .strictObject({ state: stateSchema, question: questionSchema, criteria: criteriaSchema.optional(), ...commonFields })
  .superRefine(refineThresholds);

export const classifyInput = z
  .strictObject({ state: stateSchema, question: questionSchema, options: optionsSchema, ...commonFields })
  .superRefine(refineThresholds);

export const scoreInput = z
  .strictObject({ state: stateSchema, question: questionSchema, levels: levelsSchema, ...commonFields })
  .superRefine(refineThresholds);

export const modelsInput = z.strictObject({});

const gateFields = { certainty: z.number().min(0).max(1), decision: decisionSchema };
const distribution = z.record(z.string(), z.number()).optional();

export const checkOutput = z.object({
  answer: z.boolean(),
  ...gateFields,
  probability: z.number().min(0).max(1).optional(),
});
export const classifyOutput = z.object({ answer: z.string(), ...gateFields, probabilities: distribution });
export const scoreOutput = z.object({ answer: z.number(), ...gateFields, probabilities: distribution });
/** Each edge is a fraction of the image's height (top, bottom) or width (left, right), measured from its top-left corner. */
const edge = z.number().min(0).max(1);
const boxOutput = z.object({ answer: z.object({ top: edge, bottom: edge, left: edge, right: edge }), ...gateFields });
export const answerSchema = z.union([checkOutput, classifyOutput, scoreOutput, boxOutput]);

/** What `jev_ask` returns when its answers take the given shapes. */
const askOutputOf = <A extends z.ZodType>(answer: A) => {
  const answersSchema = z.record(z.string(), answer);
  return z.object({
    /** With `state`: question id → answer. */
    answers: answersSchema.optional(),
    /** With `files`: record key → question id → answer; the best `top` in rank order, absent for `counts` alone. */
    files: z.record(z.string(), answersSchema).optional(),
    /** With `files` and `where`, `top` or `counts`: how many records were answered. */
    total: z.number().optional(),
    /** With `files` and `where`: how many records passed it, before `top` cuts them. */
    matched: z.number().optional(),
    /** With `files` and `counts`: question id → answer → how many records gave it. */
    counts: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    /** With `files`: record key → its text, for small returned records with a review or abstain answer. */
    unsure: z.record(z.string(), z.string()).optional(),
    /** With `files`: how many returned records with a review or abstain answer have no text in `unsure`, being too large or past the call's budget. */
    more_unsure: z.number().optional(),
    /** With `files`: record key → why it has no answers, at most 20 of them. */
    errors: z.record(z.string(), z.string()).optional(),
    /** With `files`: how many more errors there were than `errors` lists. */
    more_errors: z.number().optional(),
  });
};
/** Without a box answer, which only images give: with them off, `jev_ask` lists the output it had before Box. */
export const askOutput = askOutputOf(z.union([checkOutput, classifyOutput, scoreOutput]));
export const askImagesOutput = askOutputOf(answerSchema);

export const modelsOutput = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      release_date: z.string(),
    }),
  ),
  default_model: z.string(),
});

export type AskQuestion = z.infer<typeof askQuestionSchema>;
export type AskInput = z.infer<typeof askInput>;
export type JevAnswer = z.infer<typeof answerSchema>;
