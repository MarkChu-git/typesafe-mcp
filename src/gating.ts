import type { BoxCoordinates, BoxResponse, ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { DEFAULT_THRESHOLDS } from "./config.ts";
import type { JevAnswer } from "./schemas.ts";

export type Decision = "act" | "review" | "abstain";

/** How to read an answer; shared by every question tool's description. */
export const ANSWER_NOTE =
  "Jev does not generate text. Each answer has `answer`, `certainty` (0–1, how sure Jev is) and `decision`: act if certainty ≥ act_above (default 0.8), review if ≥ review_above (default 0.5), else abstain.";

export interface Thresholds {
  act_above: number;
  review_above: number;
}

type Answer = NoulResponse | ChoiceResponse | ScoreResponse | BoxResponse;

export function thresholdsFrom(input: {
  act_above?: number | undefined;
  review_above?: number | undefined;
}): Thresholds {
  return {
    act_above: input.act_above ?? DEFAULT_THRESHOLDS.act_above,
    review_above: input.review_above ?? DEFAULT_THRESHOLDS.review_above,
  };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Choice/Score/Box use API `confidence`, a box without one counting as 0; Noul uses distance from 0.5, scaled to [0, 1]. */
export function certaintyOf(a: Answer): number {
  if (a.type === "noul") return clamp01(Math.abs(a.noul - 0.5) * 2);
  return clamp01(a.confidence ?? 0);
}

export function decide(certainty: number, th: Thresholds): Decision {
  if (certainty >= th.act_above) return "act";
  if (certainty >= th.review_above) return "review";
  return "abstain";
}

export const round = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Rounds down, so a shown certainty never exceeds Jev's. The epsilon absorbs float error such as 0.29 × 100 = 28.999…. */
export const roundDown = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.floor(x * f + 1e-9) / f;
};

const rounded = (record: Record<PropertyKey, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, round(v, 3)]));

/** A box's edges inside the image, to 3 decimals: under 2 px on Jev's largest image, 1568 px a side. */
const edges = (box: BoxCoordinates): BoxCoordinates => ({
  top: round(clamp01(box.top), 3),
  bottom: round(clamp01(box.bottom), 3),
  left: round(clamp01(box.left), 3),
  right: round(clamp01(box.right), 3),
});

/**
 * What the agent reads for one question: the answer, a certainty rounded down to 2 decimals and the
 * decision taken on that value, so the two never disagree and the gate is never looser than its
 * thresholds. `detailed` adds the probabilities behind the answer, which a box does not have.
 */
export function toAnswer(a: Answer, th: Thresholds, detailed = false): JevAnswer {
  const certainty = roundDown(certaintyOf(a), 2);
  const gate = { certainty, decision: decide(certainty, th) };
  switch (a.type) {
    case "noul":
      return { answer: a.noul >= 0.5, ...gate, ...(detailed ? { probability: round(a.noul, 3) } : {}) };
    case "choice":
      return { answer: a.choice, ...gate, ...(detailed ? { probabilities: rounded(a.probabilities) } : {}) };
    case "score":
      return { answer: round(a.score, 2), ...gate, ...(detailed ? { probabilities: rounded(a.probabilities) } : {}) };
    case "box":
      return { answer: edges(a.box), ...gate };
  }
}
