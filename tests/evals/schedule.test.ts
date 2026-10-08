import { describe, expect, test } from "bun:test";
import { buildMatrix, executeMatrix, pendingRuns, runId } from "../../evals/harness/schedule.ts";
import type { RunKey, RunStatus } from "../../evals/harness/types.ts";
import { record } from "./helpers.ts";

const matrix = buildMatrix(["t1", "t2"], ["baseline", "jev-all"], 3);

describe("buildMatrix", () => {
  test("interleaves rep → task → arm", () => {
    expect(matrix).toHaveLength(12);
    expect(matrix.slice(0, 4).map(runId)).toEqual([
      "t1__baseline__1",
      "t1__jev-all__1",
      "t2__baseline__1",
      "t2__jev-all__1",
    ]);
    expect(matrix.at(-1)).toEqual({ task: "t2", arm: "jev-all", rep: 3 });
  });
});

describe("pendingRuns", () => {
  test("re-runs rate-limited and errored runs only", () => {
    const done = new Map<string, RunStatus>([
      ["t1__baseline__1", "answered"],
      ["t1__jev-all__1", "rate_limited"],
      ["t2__baseline__1", "error"],
      ["t2__jev-all__1", "no_answer"],
    ]);
    const pending = pendingRuns(matrix, done).map(runId);
    expect(pending).toHaveLength(10);
    expect(pending).toContain("t1__jev-all__1");
    expect(pending).toContain("t2__baseline__1");
    expect(pending).not.toContain("t1__baseline__1");
    expect(pending).not.toContain("t2__jev-all__1");
  });
});

describe("executeMatrix", () => {
  const base = { maxTotalUsd: 100, stopAtUtilization: 0.85, concurrency: 1 };

  test("stops starting runs once the total budget is reached", async () => {
    const res = await executeMatrix(matrix, { ...base, maxTotalUsd: 5, runOne: async (k) => record(k, { costUsd: 0.73 }) });
    expect(res.records).toHaveLength(7);
    expect(res.notRun).toHaveLength(5);
    expect(res.stopped).toBe("budget");
    expect(res.spentUsd).toBeCloseTo(5.11);
  });

  test("stops when the subscription window is nearly used up", async () => {
    let n = 0;
    const res = await executeMatrix(matrix, {
      ...base,
      runOne: async (k) => {
        n += 1;
        const quota = { status: "allowed", fiveHourUtilization: n === 2 ? 0.9 : 0.1, sevenDayUtilization: 0, resetsAt: null };
        return record(k, { quota });
      },
    });
    expect(res.records).toHaveLength(2);
    expect(res.stopped).toBe("quota");
  });

  test("stops after a rate-limited run", async () => {
    let n = 0;
    const res = await executeMatrix(matrix, {
      ...base,
      runOne: async (k) => {
        n += 1;
        return record(k, { status: n === 3 ? "rate_limited" : "answered" });
      },
    });
    expect(res.records).toHaveLength(3);
    expect(res.stopped).toBe("rate_limited");
    expect(res.notRun.map(runId)[0]).toBe("t2__jev-all__1");
  });

  test("concurrency 1 never overlaps runs and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const res = await executeMatrix(matrix, {
      ...base,
      runOne: async (k: RunKey) => {
        active += 1;
        peak = Math.max(peak, active);
        await Bun.sleep(1);
        active -= 1;
        return record(k);
      },
      onRecord: (r) => {
        seen.push(runId(r));
      },
    });
    expect(peak).toBe(1);
    expect(res.stopped).toBeNull();
    expect(seen).toEqual(matrix.map(runId));
  });

  test("spend carried over from a resumed run counts toward the cap", async () => {
    const res = await executeMatrix(matrix, { ...base, maxTotalUsd: 5, spentUsd: 5, runOne: async (k) => record(k) });
    expect(res.records).toHaveLength(0);
    expect(res.notRun).toHaveLength(12);
    expect(res.stopped).toBe("budget");
  });
});
