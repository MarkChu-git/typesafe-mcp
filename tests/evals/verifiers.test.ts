import { describe, it, expect } from "bun:test";
import { normLabel, normPath, exactMatch, setF1, itemAccuracy, weightedCost } from "../../evals/verifiers.ts";

describe("verifiers", () => {
  describe("normLabel", () => {
    it("trims and lowercases", () => {
      expect(normLabel(" Billing ")).toBe("billing");
      expect(normLabel("URGENT")).toBe("urgent");
      expect(normLabel("  Mixed Case  ")).toBe("mixed case");
    });
  });

  describe("normPath", () => {
    it("converts backslashes to forward slashes", () => {
      expect(normPath("src\\file.ts")).toBe("src/file.ts");
    });

    it("strips leading ./ and /", () => {
      expect(normPath("./src/file.ts")).toBe("src/file.ts");
      expect(normPath("/src/file.ts")).toBe("src/file.ts");
    });

    it("normalizes paths and removes trailing slash", () => {
      expect(normPath("./src//a/../b.ts")).toBe("src/b.ts");
      expect(normPath("src/")).toBe("src");
    });
  });

  describe("exactMatch", () => {
    it("matches after normalization", () => {
      expect(exactMatch("Billing", "billing")).toBe(1);
      expect(exactMatch("  URGENT  ", "urgent")).toBe(1);
      expect(exactMatch("billing", "technical")).toBe(0);
    });
  });

  describe("setF1", () => {
    it("returns 1,1,1 for empty both sets", () => {
      const result = setF1([], []);
      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
    });

    it("calculates F1 correctly for partial match", () => {
      const pred = ["file1.ts", "file2.ts", "file3.ts", "extra.ts"];
      const gold = ["file1.ts", "file2.ts", "file3.ts", "file4.ts"];
      const result = setF1(pred, gold);

      expect(result.precision).toBeCloseTo(0.75, 5); // 3/4
      expect(result.recall).toBeCloseTo(0.75, 5); // 3/4
      expect(result.f1).toBeCloseTo(0.75, 5);
    });

    it("returns 0 F1 when no overlap", () => {
      const result = setF1(["a"], ["b"]);
      expect(result.f1).toBe(0);
      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
    });

    it("deduplicates after normalizing", () => {
      const pred = ["File.ts", "file.ts"];
      const gold = ["file.ts"];
      const result = setF1(pred, gold);
      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
    });

    it("applies custom normalization", () => {
      const pred = ["./src/a.ts", "src/c.ts"];
      const gold = ["src/a.ts", "src/b.ts"];
      const result = setF1(pred, gold, normPath);
      expect(result.precision).toBeCloseTo(0.5, 5); // 1 match out of 2 predictions
      expect(result.recall).toBeCloseTo(0.5, 5); // 1 match out of 2 gold
      expect(result.f1).toBeCloseTo(0.5, 5);
    });
  });

  describe("itemAccuracy", () => {
    it("returns 1 when gold is empty", () => {
      expect(itemAccuracy({}, {})).toBe(1);
      expect(itemAccuracy({ extra: "value" }, {})).toBe(1);
    });

    it("calculates accuracy with string normalization", () => {
      const pred = { T001: "Billing", T002: "Technical", T003: "Missing" };
      const gold = { T001: "billing", T002: "TECHNICAL", T003: "Account" };
      expect(itemAccuracy(pred, gold)).toBeCloseTo(2 / 3, 5); // 2 out of 3 correct
    });

    it("returns 0 for missing prediction keys", () => {
      const pred = { T001: "billing" };
      const gold = { T001: "billing", T002: "technical" };
      expect(itemAccuracy(pred, gold)).toBe(0.5); // 1 out of 2
    });

    it("ignores extra predictions", () => {
      const pred = { T001: "billing", T002: "technical", T003: "extra" };
      const gold = { T001: "billing", T002: "technical" };
      expect(itemAccuracy(pred, gold)).toBe(1);
    });

    it("uses custom equality function", () => {
      const pred = { id1: 5, id2: 10 };
      const gold = { id1: 5, id2: 9 };
      expect(itemAccuracy(pred, gold, (a, b) => (a as number) === (b as number))).toBe(0.5);
    });
  });

  describe("weightedCost", () => {
    it("returns 1 when gold is empty", () => {
      expect(weightedCost({}, {}, {})).toBe(1);
    });

    it("scores 1 when predictions match gold perfectly", () => {
      const pred = { R01: "auto_approve", R02: "deny" };
      const gold = { R01: "auto_approve", R02: "deny" };
      const cost = {
        auto_approve: { auto_approve: 0, human_review: 1, deny: 2 },
        deny: { auto_approve: 5, human_review: 1, deny: 0 },
      };
      expect(weightedCost(pred, gold, cost)).toBe(1);
    });

    it("applies cost table correctly", () => {
      const pred = { R01: "human_review" };
      const gold = { R01: "auto_approve" };
      const cost = {
        auto_approve: { auto_approve: 0, human_review: 1, deny: 2 },
      };
      // actual = 1, worst = 2, score = 1 - 1/2 = 0.5
      expect(weightedCost(pred, gold, cost)).toBe(0.5);
    });

    it("uses maximum cost for missing predictions", () => {
      const pred = {};
      const gold = { R01: "auto_approve" };
      const cost = {
        auto_approve: { auto_approve: 0, human_review: 1, deny: 2 },
      };
      // actual = max(0, 1, 2) = 2, worst = 2, score = 1 - 2/2 = 0
      expect(weightedCost(pred, gold, cost)).toBe(0);
    });

    it("demonstrates refund cost scenario", () => {
      // auto_approve predicted for human_review gold
      const pred = { R01: "auto_approve" };
      const gold = { R01: "human_review" };
      const cost = {
        auto_approve: { auto_approve: 0, human_review: 1, deny: 2 },
        human_review: { auto_approve: 5, human_review: 0, deny: 2 },
      };
      const autoScore = weightedCost(pred, gold, cost);

      // deny predicted for human_review gold
      const pred2 = { R01: "deny" };
      const denyScore = weightedCost(pred2, gold, cost);

      // auto_approve should score lower than deny
      // auto: actual=5, worst=5, score=0; deny: actual=2, worst=5, score=0.6
      expect(autoScore).toBeLessThan(denyScore);
    });

    it("normalizes labels in cost lookups", () => {
      const pred = { R01: "AUTO_APPROVE" };
      const gold = { R01: "  Auto Approve  " };
      const cost = {
        auto_approve: { auto_approve: 0, human_review: 1, deny: 2 },
      };
      expect(weightedCost(pred, gold, cost)).toBe(1);
    });
  });

  describe("determinism", () => {
    it("scores same input twice identically", () => {
      const pred = { T001: "Billing", T002: "Technical" };
      const gold = { T001: "billing", T002: "technical" };
      const score1 = itemAccuracy(pred, gold);
      const score2 = itemAccuracy(pred, gold);
      expect(score1).toBe(score2);
    });
  });
});
