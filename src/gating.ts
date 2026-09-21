import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { DEFAULT_THRESHOLDS } from "./config.ts";

export type Decision = "act" | "review" | "abstain";

export interface Thresholds {
  act_above: number;
  review_above: number;
}

type Answer = NoulResponse | ChoiceResponse | ScoreResponse;

export function thresholdsFrom(input: { act_above?: number; review_above?: number }): Thresholds {
  return {
    act_above: input.act_above ?? DEFAULT_THRESHOLDS.act_above,
    review_above: input.review_above ?? DEFAULT_THRESHOLDS.review_above,
  };
}

/** Choice/Score use API `confidence`; Noul uses distance from 0.5, scaled to [0, 1]. */
export function certaintyOf(a: Answer): number {
  if (a.type === "noul") return Math.min(1, Math.max(0, Math.abs(a.noul - 0.5) * 2));
  return Math.min(1, Math.max(0, a.confidence));
}

export function decide(certainty: number, th: Thresholds): Decision {
  if (certainty >= th.act_above) return "act";
  if (certainty >= th.review_above) return "review";
  return "abstain";
}

const stringKeys = <V>(record: Record<PropertyKey, V>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [String(k), v]));

export function withDecision(a: Answer, th: Thresholds) {
  const certainty = certaintyOf(a);
  const gate = { certainty, decision: decide(certainty, th), thresholds: th };
  switch (a.type) {
    case "noul":
      return { type: "noul" as const, probability: a.noul, answer: a.noul >= 0.5, ...gate };
    case "choice":
      return {
        type: "choice" as const,
        choice: a.choice,
        probabilities: a.probabilities,
        confidence: a.confidence,
        ...gate,
      };
    case "score":
      return {
        type: "score" as const,
        score: a.score,
        legend: stringKeys(a.legend),
        probabilities: stringKeys(a.probabilities),
        confidence: a.confidence,
        ...gate,
      };
  }
}
