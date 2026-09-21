import { noul, type NoulQuestion } from "@typesafe-ai/sdk";

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
