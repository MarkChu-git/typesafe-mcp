import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import type { Split } from "../harness/types.ts";

export type TaskCategory = "triage" | "gating" | "retrieval" | "verification" | "scoring" | "control";

export interface ScoreResult {
  /** In [0, 1]. */
  score: number;
  passed: boolean;
  details?: Record<string, unknown>;
}

/** What a task module authors. `A` is the answer shape (without `feedback`). */
export interface EvalTask<A extends Record<string, unknown>> {
  id: string;
  title: string;
  category: TaskCategory;
  split: Split;
  /** Absolute task directory holding `workspace/`, `gold.json` and (after human review) `REVIEW.md`. */
  dir: string;
  /** User prompt for `claude -p`. Must tell the agent to return the answer as structured output. */
  prompt: string;
  /** Must be a `z.object`. The harness adds the optional `feedback` field itself. */
  answer: z.ZodType<A>;
  /** Deterministic; must not call any model. */
  score(answer: A, gold: A): ScoreResult;
}

export type ParseResult = { ok: true; answer: unknown; feedback: string | null } | { ok: false; error: string };

/** Type-erased task used by the harness. */
export interface RegisteredTask {
  id: string;
  title: string;
  category: TaskCategory;
  split: Split;
  dir: string;
  prompt: string;
  workspaceDir: string;
  reviewed: boolean;
  /** JSON Schema for `--json-schema`: the answer schema plus an optional `feedback` string. */
  jsonSchema(): Record<string, unknown>;
  /** Splits `feedback` off `structured_output` and validates the rest against the answer schema. */
  parse(structuredOutput: unknown): ParseResult;
  /** Reads and validates `gold.json`. */
  gold(): unknown;
  score(answer: unknown, gold: unknown): ScoreResult;
}

export function defineTask<A extends Record<string, unknown>>(task: EvalTask<A>): RegisteredTask {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    split: task.split,
    dir: task.dir,
    prompt: task.prompt,
    workspaceDir: join(task.dir, "workspace"),
    reviewed: existsSync(join(task.dir, "REVIEW.md")),
    jsonSchema() {
      const schema = z.toJSONSchema(task.answer) as Record<string, unknown>;
      const properties = { ...(schema.properties as Record<string, unknown> | undefined) };
      properties.feedback = {
        type: "string",
        description: "One or two sentences: which tools helped, which confused you.",
      };
      const { $schema: _ignored, additionalProperties: _strict, ...rest } = schema;
      return { ...rest, properties };
    },
    parse(structuredOutput) {
      if (typeof structuredOutput !== "object" || structuredOutput === null || Array.isArray(structuredOutput)) {
        return { ok: false, error: "structured output is not an object" };
      }
      const { feedback, ...answer } = structuredOutput as Record<string, unknown>;
      const parsed = task.answer.safeParse(answer);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      return { ok: true, answer: parsed.data, feedback: typeof feedback === "string" ? feedback : null };
    },
    gold() {
      const raw: unknown = JSON.parse(readFileSync(join(task.dir, "gold.json"), "utf8"));
      return task.answer.parse(raw);
    },
    score(answer, gold) {
      return task.score(answer as A, gold as A);
    },
  };
}
