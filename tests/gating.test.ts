import { describe, expect, test } from "bun:test";
import { DEFAULT_THRESHOLDS } from "../src/config.ts";
import { certaintyOf, decide } from "../src/gating.ts";

const defaults = { act_above: DEFAULT_THRESHOLDS.act_above, review_above: DEFAULT_THRESHOLDS.review_above };

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

  test("noul 0.05 → certainty 0.9, answer is no, decision act", () => {
    const a = { type: "noul" as const, noul: 0.05 };
    const certainty = certaintyOf(a);
    expect(certainty).toBeCloseTo(0.9);
    expect(a.noul >= 0.5).toBe(false);
    expect(decide(certainty, defaults)).toBe("act");
  });

  test("noul 0.5 → certainty 0 and abstain", () => {
    const certainty = certaintyOf({ type: "noul", noul: 0.5 });
    expect(certainty).toBe(0);
    expect(decide(certainty, defaults)).toBe("abstain");
  });

  test("choice uses confidence, not top probability", () => {
    const certainty = certaintyOf({
      type: "choice",
      choice: "a",
      probabilities: { a: 0.6, b: 0.4 },
      confidence: 0.2,
    });
    expect(certainty).toBe(0.2);
    expect(decide(certainty, defaults)).toBe("abstain");
  });
});
