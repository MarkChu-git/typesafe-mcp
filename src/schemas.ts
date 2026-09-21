import * as z from "zod/v4";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const stateSchema = z
  .union([z.string().min(1), z.record(z.string(), jsonValue), z.array(jsonValue).min(1)])
  .describe(
    "The content Jev evaluates: a plain string, a JSON object (fields can be referenced from the question as `field`), or an array of JSON values. Send only what the question needs; irrelevant detail lowers accuracy. Max ~32k tokens together with the longest question.",
  );

export const questionSchema = z
  .string()
  .min(1)
  .describe(
    "The question in plain English (other languages work but are less accurate). Jev reads literally: state the exact condition, avoid double negatives and multi-hop reasoning. Jev does NOT generate text; it only answers this structured question.",
  );

export const modelSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Model id or alias. Default jev-latest. Pin a versioned id like jev-1.13.0 when thresholds are tuned.");

export const thresholdsFields = {
  act_above: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Certainty at or above this → decision "act". Default 0.8. Raise for high-stakes actions.'),
  review_above: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Certainty at or above this (but below act_above) → "review". Below → "abstain". Default 0.5.'),
};
export const thresholdFields = thresholdsFields;

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

export const decisionSchema = z.enum(["act", "review", "abstain"]);
export const thresholdsOut = z.object({ act_above: z.number(), review_above: z.number() });
export const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export const metaFields = { model: z.string().min(1), usage: usageSchema };
export const metaSchema = z.object(metaFields);
export const gateFields = {
  certainty: z.number().min(0).max(1),
  decision: decisionSchema,
  thresholds: thresholdsOut,
};

export const noulCriteriaSchema = z
  .object({
    true: z.string().min(1).optional().describe("What a YES (probability near 1) means."),
    false: z.string().min(1).optional().describe("What a NO (probability near 0) means."),
  })
  .optional()
  .describe("Optional descriptions of the yes/no outcomes. Keep them aligned with the question.");

export const optionsSchema = z
  .record(z.string().min(1), z.string().nullable())
  .refine((o) => Object.keys(o).length >= 2, "at least 2 options are required")
  .refine((o) => Object.keys(o).length <= 255, "at most 255 options are allowed")
  .describe(
    "Closed set of options: label → short rubric (or null). 2–255 entries. Jev must pick exactly one.",
  );

export const levelsSchema = z
  .array(z.string().nullable())
  .min(2)
  .max(10)
  .describe(
    "Ordered rubric levels, index 0 first. 2–10 entries. Returned score is a probability-weighted value across indices.",
  );

export const modelsInput = z.strictObject({});
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

export const checkInput = z
  .strictObject({
    state: stateSchema,
    question: questionSchema,
    criteria: noulCriteriaSchema,
    model: modelSchema,
    ...thresholdsFields,
  })
  .superRefine(refineThresholds);

export const checkOutput = z.object({
  type: z.literal("noul"),
  probability: z.number().min(0).max(1),
  answer: z.boolean(),
  ...gateFields,
  ...metaFields,
});

export const classifyInput = z
  .strictObject({
    state: stateSchema,
    question: questionSchema,
    options: optionsSchema,
    model: modelSchema,
    ...thresholdsFields,
  })
  .superRefine(refineThresholds);

export const classifyOutput = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
  ...gateFields,
  ...metaFields,
});

export const scoreInput = z
  .strictObject({
    state: stateSchema,
    question: questionSchema,
    levels: levelsSchema,
    model: modelSchema,
    ...thresholdsFields,
  })
  .superRefine(refineThresholds);

export const scoreOutput = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string().nullable()),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
  ...gateFields,
  ...metaFields,
});

const askNoulQuestion = z.strictObject({
  type: z.literal("noul").describe("Yes/no question."),
  question: questionSchema,
  criteria: noulCriteriaSchema,
});
const askChoiceQuestion = z.strictObject({
  type: z.literal("choice").describe("Pick exactly one key from `options`."),
  question: questionSchema,
  options: optionsSchema,
});
const askScoreQuestion = z.strictObject({
  type: z.literal("score").describe("Rate on the ordered `levels` rubric."),
  question: questionSchema,
  levels: levelsSchema,
});

export const askQuestionSchema = z.discriminatedUnion("type", [
  askNoulQuestion,
  askChoiceQuestion,
  askScoreQuestion,
]);

export const askInput = z
  .strictObject({
    state: stateSchema,
    questions: z
      .record(z.string().min(1), askQuestionSchema)
      .refine((q) => Object.keys(q).length >= 1, "at least one question is required")
      .describe(
        "Map of your own question ids → question. All are answered in ONE request against the same state. Batching is ~10x cheaper and faster than separate calls.",
      ),
    model: modelSchema,
    ...thresholdsFields,
  })
  .superRefine(refineThresholds);

const askNoulAnswer = z.object({
  type: z.literal("noul"),
  probability: z.number().min(0).max(1),
  answer: z.boolean(),
  ...gateFields,
});
const askChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
  ...gateFields,
});
const askScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string().nullable()),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
  ...gateFields,
});

export const askOutput = z.object({
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [askNoulAnswer, askChoiceAnswer, askScoreAnswer]),
  ),
  ...metaFields,
});

export type ModelsInput = z.infer<typeof modelsInput>;
export type ModelsOutput = z.infer<typeof modelsOutput>;
export type CheckInput = z.infer<typeof checkInput>;
export type CheckOutput = z.infer<typeof checkOutput>;
export type ClassifyInput = z.infer<typeof classifyInput>;
export type ClassifyOutput = z.infer<typeof classifyOutput>;
export type ScoreInput = z.infer<typeof scoreInput>;
export type ScoreOutput = z.infer<typeof scoreOutput>;
export type AskQuestion = z.infer<typeof askQuestionSchema>;
export type AskInput = z.infer<typeof askInput>;
export type AskOutput = z.infer<typeof askOutput>;
