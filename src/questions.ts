import {
  choice,
  noul,
  score,
  type ChoiceQuestion,
  type EntryType,
  type NoulQuestion,
  type Question,
  type Questions,
  type ScoreQuestion,
} from "@typesafe-ai/sdk";
import type { AskInput, AskQuestion } from "./schemas.ts";

/** Tool arguments arrive as parsed JSON, so the untyped nested values of `state` are JSON values. */
export const toState = (state: AskInput["state"]): EntryType => state as EntryType;

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
export function toSdkQuestion(q: AskQuestion): Question {
  switch (q.type) {
    case "noul":
      return toNoulQuestion(q);
    case "choice":
      if (!q.options) throw new Error("options is required when type is choice");
      return toChoiceQuestion({ question: q.question, options: q.options });
    case "score":
      if (!q.levels) throw new Error("levels is required when type is score");
      return toScoreQuestion({ question: q.question, levels: q.levels });
  }
}

export function buildQuestions(record: Record<string, AskQuestion>): Questions {
  return Object.fromEntries(Object.entries(record).map(([id, q]) => [id, toSdkQuestion(q)]));
}
