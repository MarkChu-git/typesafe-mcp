import { describe, expect, test } from "bun:test";
import { DEFAULT_THRESHOLDS } from "../src/config.ts";
import { certaintyOf, decide, round, roundDown, toAnswer } from "../src/gating.ts";

const defaults = { act_above: DEFAULT_THRESHOLDS.act_above, review_above: DEFAULT_THRESHOLDS.review_above };
const choice = (confidence: number) => ({
  type: "choice" as const,
  choice: "a",
  probabilities: { a: 0.61234, b: 0.38766 },
  confidence,
});

describe("decide", () => {
  test("0.80 is act under default thresholds", () => {
    expect(decide(0.8, defaults)).toBe("act");
  });

  test("0.79 is review under default thresholds", () => {
    expect(decide(0.79, defaults)).toBe("review");
  });

  test("0.49 is abstain under default thresholds", () => {
    expect(decide(0.49, defaults)).toBe("abstain");
  });

  test("override act_above 0.95 turns certainty 0.9 into review", () => {
    expect(decide(0.9, { act_above: 0.95, review_above: 0.5 })).toBe("review");
  });
});

describe("certaintyOf", () => {
  test("noul 0.95 → certainty 0.9 and act", () => {
    const certainty = certaintyOf({ type: "noul", noul: 0.95 });
    expect(certainty).toBeCloseTo(0.9);
    expect(decide(certainty, defaults)).toBe("act");
  });

  test("noul 0.5 → certainty 0 and abstain", () => {
    const certainty = certaintyOf({ type: "noul", noul: 0.5 });
    expect(certainty).toBe(0);
    expect(decide(certainty, defaults)).toBe("abstain");
  });

  test("choice uses confidence, not top probability", () => {
    const certainty = certaintyOf(choice(0.2));
    expect(certainty).toBe(0.2);
    expect(decide(certainty, defaults)).toBe("abstain");
  });
});

describe("toAnswer", () => {
  test("noul: answer is the yes/no side, certainty is its distance from 0.5", () => {
    expect(toAnswer({ type: "noul", noul: 0.95 }, defaults)).toEqual({ answer: true, certainty: 0.9, decision: "act" });
    expect(toAnswer({ type: "noul", noul: 0.05 }, defaults)).toEqual({ answer: false, certainty: 0.9, decision: "act" });
  });

  test("certainty is rounded down to 2 decimals and decided on, so the gate is never looser than act_above", () => {
    expect(toAnswer(choice(0.799), defaults)).toEqual({ answer: "a", certainty: 0.79, decision: "review" });
    expect(toAnswer(choice(0.8), defaults)).toEqual({ answer: "a", certainty: 0.8, decision: "act" });
    expect(toAnswer(choice(0.809), defaults)).toEqual({ answer: "a", certainty: 0.8, decision: "act" });
    // Float error such as 0.29 * 100 = 28.999… does not cost a hundredth.
    expect(toAnswer(choice(0.29), defaults).certainty).toBe(0.29);
    expect(toAnswer({ type: "noul", noul: 0.9 }, defaults)).toMatchObject({ certainty: 0.8, decision: "act" });
  });

  test("score: answer is the expected level, rounded to 2 decimals", () => {
    const a = { type: "score" as const, score: 1.0549, confidence: 0.7, legend: {}, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } };
    expect(toAnswer(a, defaults)).toEqual({ answer: 1.05, certainty: 0.7, decision: "review" });
  });

  test("detailed adds probabilities rounded to 3 decimals", () => {
    expect(toAnswer({ type: "noul", noul: 0.91234 }, defaults, true)).toMatchObject({ probability: 0.912 });
    expect(toAnswer(choice(0.9), defaults, true)).toMatchObject({ probabilities: { a: 0.612, b: 0.388 } });
  });
});

describe("round", () => {
  test("rounds to the given number of decimals", () => {
    expect(round(0.12345, 2)).toBe(0.12);
    expect(round(0.12355, 3)).toBe(0.124);
    expect(round(1, 2)).toBe(1);
  });

  test("roundDown never rounds up, apart from float error", () => {
    expect(roundDown(0.799999, 2)).toBe(0.79);
    expect(roundDown(0.29, 2)).toBe(0.29);
    expect(roundDown(1, 2)).toBe(1);
    expect(roundDown(0, 2)).toBe(0);
  });
});
