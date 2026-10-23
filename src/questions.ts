import {
  box,
  choice,
  noul,
  score,
  type BoxQuestion,
  type ChoiceQuestion,
  type EntryType,
  type NoulQuestion,
  type ScoreQuestion,
} from "@typesafe-ai/sdk";
import type { AskInput, AskQuestion } from "./schemas.ts";

/** Tool arguments arrive as parsed JSON, so the untyped nested values of `state` are JSON values. */
export const toState = (state: AskInput["state"]): NonNullable<EntryType> => state as NonNullable<EntryType>;

/** The question types this server asks; `box` needs an image. */
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion | BoxQuestion;
export type JevQuestions = Record<string, JevQuestion>;

/** Whether a call asks a box question, which only an image can answer. */
export const hasBox = (questions: Readonly<Record<string, { type: string }>>): boolean =>
  Object.values(questions).some((q) => q.type === "box");

/**
 * Whether `model` answers box questions. Jev before 1.14 answers one with a bare 400 "Invalid request.";
 * a name without a version, such as `jev-latest`, is left to the API.
 */
export function takesBox(model: string): boolean {
  const version = /^jev-(\d+)\.(\d+)/i.exec(model.trim());
  if (version === null) return true;
  const major = Number(version[1]);
  return major > 1 || (major === 1 && Number(version[2]) >= 14);
}

export interface NoulQuestionInput {
  question: string;
  criteria?: { true?: string | undefined; false?: string | undefined } | undefined;
}

export function toNoulQuestion(input: NoulQuestionInput): NoulQuestion {
  if (!input.criteria) return noul(input.question, null);
  const criteria = {
    ...(input.criteria.true !== undefined ? { true: input.criteria.true } : {}),
    ...(input.criteria.false !== undefined ? { false: input.criteria.false } : {}),
  };
  return noul(input.question, criteria);
}

export interface ChoiceQuestionInput {
  question: string;
  options: Record<string, string | null>;
}

export function toChoiceQuestion(input: ChoiceQuestionInput): ChoiceQuestion {
  return choice(input.question, input.options);
}

export interface ScoreQuestionInput {
  question: string;
  levels: (string | null)[];
}

export function toScoreQuestion(input: ScoreQuestionInput): ScoreQuestion {
  const [first, second, ...rest] = input.levels;
  return score(input.question, [first ?? null, second ?? null, ...rest]);
}

/** `askQuestionSchema` guarantees the type's own field is present; the throws only guard direct callers. */
export function toSdkQuestion(q: AskQuestion): JevQuestion {
  switch (q.type) {
    case "noul":
      return toNoulQuestion(q);
    case "choice":
      if (!q.options) throw new Error("options is required when type is choice");
      return toChoiceQuestion({ question: q.question, options: q.options });
    case "score":
      if (!q.levels) throw new Error("levels is required when type is score");
      return toScoreQuestion({ question: q.question, levels: q.levels });
    case "box":
      return box(q.question);
  }
}

export function buildQuestions(record: Record<string, AskQuestion>): JevQuestions {
  return Object.fromEntries(Object.entries(record).map(([id, q]) => [id, toSdkQuestion(q)]));
}
