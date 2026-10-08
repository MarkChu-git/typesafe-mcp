import * as z from "zod/v4";

// Input schemas become the tool definitions an agent reads on every model call, so descriptions
// live in one place (the tool description or a single field) and nested values stay untyped.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const stateSchema = z
  .union([z.string().min(1), z.looseObject({}), z.array(z.unknown()).min(1)])
  .describe(
    "What Jev judges: text, a JSON object or a JSON array. Send only what the questions need; extra detail lowers accuracy. Max ~32k tokens.",
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

/** The field each type requires; the other type-specific fields are rejected. */
const TYPE_FIELD = { noul: "criteria", choice: "options", score: "levels" } as const;
const REQUIRED = new Set(["options", "levels"]);

/** One flat object instead of a union, so the agent reads `question` and its guidance once. */
export const askQuestionSchema = z
  .strictObject({
    type: z.enum(QUESTION_TYPES).describe("noul: yes/no. choice: pick one key of options. score: rate on levels."),
    question: questionSchema,
    options: optionsSchema.optional().describe("choice only. Label → rubric or null, 2–255 labels."),
    levels: levelsSchema.optional().describe("score only. Rubric per level, index 0 first, 2–10 levels."),
    criteria: criteriaSchema.optional().describe("noul only. What yes and no mean."),
  })
  .superRefine((q, ctx) => {
    for (const field of Object.values(TYPE_FIELD)) {
      const own = TYPE_FIELD[q.type] === field;
      const present = q[field] !== undefined;
      if (own && !present && REQUIRED.has(field)) {
        ctx.addIssue({ code: "custom", path: [field], message: `required when type is ${q.type}` });
      } else if (!own && present) {
        ctx.addIssue({ code: "custom", path: [field], message: `not used when type is ${q.type}` });
      }
    }
  });

export const filesSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(20)])
  .describe(
    "Instead of state: glob(s) relative to the project root, e.g. tickets/*.md. The server reads each file and asks it the same questions, so nothing is copied. One Jev request per file, max 100.",
  );

export const contextSchema = z
  .union([z.string().min(1), z.looseObject({})])
  .describe("With files: shared context sent with every file, e.g. the policy to apply.");

export const askInput = z
  .strictObject({
    state: stateSchema.optional(),
    files: filesSchema.optional(),
    context: contextSchema.optional(),
    questions: z
      .record(z.string(), askQuestionSchema)
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
  });

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

export const decisionSchema = z.enum(["act", "review", "abstain"]);

const gateFields = { certainty: z.number().min(0).max(1), decision: decisionSchema };
const distribution = z.record(z.string(), z.number()).optional();

export const checkOutput = z.object({
  answer: z.boolean(),
  ...gateFields,
  probability: z.number().min(0).max(1).optional(),
});
export const classifyOutput = z.object({ answer: z.string(), ...gateFields, probabilities: distribution });
export const scoreOutput = z.object({ answer: z.number(), ...gateFields, probabilities: distribution });
export const answerSchema = z.union([checkOutput, classifyOutput, scoreOutput]);
const answersSchema = z.record(z.string(), answerSchema);
export const askOutput = z.object({
  /** With `state`: question id → answer. */
  answers: answersSchema.optional(),
  /** With `files`: path → question id → answer. */
  files: z.record(z.string(), answersSchema).optional(),
  /** With `files`: path → why it has no answers. */
  errors: z.record(z.string(), z.string()).optional(),
});

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
