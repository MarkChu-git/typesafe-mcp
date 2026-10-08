import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import REFUND_TASK, { REFUND_COST } from "../../evals/tasks/refund-gating/task.ts";
import { weightedCost } from "../../evals/verifiers.ts";

// Ties the TS scorer to the Bend model in evals/laws/, whose laws PROOF.bend proves.
// Skipped where `bend` is not installed (CI).
const bend = Bun.which("bend");
const lawsDir = join(import.meta.dir, "..", "..", "evals", "laws");

function runBend(file: string): string {
  const out = Bun.spawnSync([bend ?? "bend", join(lawsDir, file)], { stdout: "pipe", stderr: "pipe" });
  return `${out.stdout.toString()}\n${out.stderr.toString()}`;
}

const LABELS = ["auto_approve", "human_review", "deny"] as const;
const ANSWERS = [null, ...LABELS] as const;

const tsScore = (items: readonly { gold: string; answer: string | null }[]): number => {
  const pred: Record<string, string> = {};
  const gold: Record<string, string> = {};
  items.forEach((item, i) => {
    gold[`R${i}`] = item.gold;
    if (item.answer !== null) pred[`R${i}`] = item.answer;
  });
  return weightedCost(pred, gold, REFUND_COST);
};

describe.skipIf(!bend)("Bend laws for the weighted-cost scorer", () => {
  test("every law in LAWS.bend is proven", () => {
    expect(runBend("PROOF.bend")).toContain("All terms check.");
  });

  // Row per gold label: costs for no answer, auto_approve, human_review, deny; then the worst case.
  const table = new Map<string, { costs: number[]; worst: number }>();
  // describe.skipIf still runs this body to collect the tests, so only call bend when it exists.
  const printed = bend ? (/"([^"]+)"/.exec(runBend("table.bend"))?.[1] ?? "") : "";
  printed.split("; ").forEach((row, i) => {
    const [costs = "", worst = ""] = row.split(" / ");
    const label = LABELS[i];
    if (label) table.set(label, { costs: costs.split(" ").map(Number), worst: Number(worst) });
  });

  const modelScore = (items: readonly { gold: string; answer: string | null }[]): number => {
    let actual = 0;
    let worst = 0;
    for (const { gold, answer } of items) {
      const row = table.get(gold);
      if (!row) throw new Error(`no model row for ${gold}`);
      actual += row.costs[ANSWERS.indexOf(answer as (typeof ANSWERS)[number])] ?? Number.NaN;
      worst += row.worst;
    }
    return worst === 0 ? 1 : 1 - actual / worst;
  };

  test("the model table covers every label", () => {
    expect([...table.keys()]).toEqual([...LABELS]);
  });

  test("single items: the TS scorer matches the model", () => {
    for (const gold of LABELS) {
      for (const answer of ANSWERS) {
        expect(tsScore([{ gold, answer }])).toBeCloseTo(modelScore([{ gold, answer }]), 12);
      }
    }
  });

  test("pairs of items: the TS scorer sums costs the way the model does", () => {
    for (const g1 of LABELS) {
      for (const a1 of ANSWERS) {
        for (const g2 of LABELS) {
          for (const a2 of ANSWERS) {
            const items = [
              { gold: g1, answer: a1 },
              { gold: g2, answer: a2 },
            ];
            expect(tsScore(items)).toBeCloseTo(modelScore(items), 12);
          }
        }
      }
    }
  });

  test("the refund task scores through the same table", () => {
    const gold = { decisions: [{ id: "R01", decision: "human_review" as const }] };
    const approved = REFUND_TASK.score({ decisions: [{ id: "R01", decision: "auto_approve" }] }, gold);
    const denied = REFUND_TASK.score({ decisions: [{ id: "R01", decision: "deny" }] }, gold);
    expect(approved.score).toBeLessThan(denied.score);
  });
});
