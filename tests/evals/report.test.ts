import { describe, expect, test } from "bun:test";
import { aggregate, buildMetricsJson, renderSummary } from "../../evals/harness/report.ts";
import type { ArmId, ProbeResult, RunRecord, ToolCallRecord } from "../../evals/harness/types.ts";
import { config, record } from "./helpers.ts";

const jevCall: ToolCallRecord = {
  name: "mcp__jev__jev_ask",
  argChars: 500,
  resultChars: 600,
  isError: false,
  latencyMs: 300,
  jevInputTokens: 400,
};

const run = (task: string, arm: ArmId, rep: number, totalTokens: number, score: number): RunRecord =>
  record({ task, arm, rep }, { totalTokens, toolCalls: arm === "baseline" ? [] : [jevCall] }, score);

const records: RunRecord[] = [
  run("t1", "baseline", 1, 1_000, 0.8),
  run("t1", "baseline", 2, 1_200, 0.9),
  run("t1", "jev-all", 1, 900, 0.85),
  run("t1", "jev-all", 2, 900, 0.85),
  run("t2", "baseline", 1, 2_000, 1),
  run("t2", "baseline", 2, 2_000, 1),
  run("t2", "jev-all", 1, 1_800, 1),
  run("t2", "jev-all", 2, 1_800, 1),
  run("t1", "jev", 1, 800, 0.5),
  record({ task: "t2", arm: "jev-all", rep: 3 }, { status: "invalid", errorMessage: "tool list mismatch" }, null),
];

const probes: ProbeResult[] = [
  { arm: "baseline", contextTokens: 4_600, tools: [], status: "answered" },
  { arm: "jev-all", contextTokens: 9_444, tools: [], status: "answered" },
];

describe("aggregate", () => {
  const agg = aggregate(records);
  const arm = (id: ArmId) => agg.arms.find((a) => a.arm === id);

  test("fewer tokens at a non-inferior score", () => {
    expect(arm("jev-all")?.tokensDeltaPct).toBeCloseTo((2_700 / 3_100 - 1) * 100);
    expect(arm("jev-all")?.scoreDelta).toBeCloseTo(0);
    expect(arm("jev-all")?.verdict).toBe("fewer-tokens-same-score");
  });

  test("fewer tokens but a lower score", () => {
    expect(arm("jev")?.verdict).toBe("fewer-tokens-lower-score");
  });

  test("a jev arm that never called jev gets no savings verdict", () => {
    const unused = aggregate([
      run("t1", "baseline", 1, 1_000, 1),
      record({ task: "t1", arm: "jev", rep: 1 }, { totalTokens: 900 }, 1),
    ]);
    expect(unused.arms.find((a) => a.arm === "jev")).toMatchObject({ jevUsageRate: 0, verdict: "jev-unused" });
  });

  test("excluded runs do not count", () => {
    const cell = agg.cells.find((c) => c.task === "t2" && c.arm === "jev-all");
    expect(cell).toMatchObject({ n: 2, excluded: 1, jevUsageRate: 1 });
    expect(cell?.totalTokens).toEqual({ mean: 1_800, min: 1_800, max: 1_800 });
    expect(cell?.jevChars.mean).toBe(1_100);
    expect(cell?.peakContext.mean).toBe(5_000);
  });
});

describe("renderSummary", () => {
  const input = { config: config(), probes, records, notRun: [], stopped: null };

  test("token efficiency comes first", () => {
    const md = renderSummary(input);
    expect(md.indexOf("## Token 效率摘要")).toBeLessThan(md.indexOf("## 各任务明细"));
    expect(md).toContain("| jev-all | 1,350 | -12.9% | $0.100 | +0.0% | 5,000 | +0.0% | 0.93 | +0.00 | 100% | 更省且不降分 |");
    expect(md).toContain("最少只有 1 次运行");
    expect(md).toContain("更省但降分");
    expect(md).toContain("| jev-all | 9,444 | +4844 | answered |");
    expect(md).toContain("- t2__jev-all__3：invalid（tool list mismatch）");
    expect(md).toContain("费用按 API 标价折算");
    expect(md).toContain("- 模型：sonnet（实际：claude-sonnet-5-5）");
  });

  test("without a baseline only absolute values are shown", () => {
    const md = renderSummary({ ...input, records: records.filter((r) => r.arm !== "baseline") });
    expect(md).toContain("缺少基线，只列绝对值");
    expect(md).not.toContain("更省");
  });

  test("dirty working tree and unreviewed tasks are flagged", () => {
    const md = renderSummary({ ...input, config: config({ gitDirtyFiles: ["src/tools/ask.ts"] }), unreviewedTasks: ["t1"] });
    expect(md).toContain("工作区有未提交的改动");
    expect(md).toContain("- `src/tools/ask.ts`");
    const many = renderSummary({ ...input, config: config({ gitDirtyFiles: Array.from({ length: 13 }, (_, i) => `f${i}.ts`) }) });
    expect(many).toContain("- `f9.ts`");
    expect(many).not.toContain("- `f10.ts`");
    expect(many).toContain("- 另有 3 个文件");
    expect(md).toContain("未经人工复核的任务（t1）");
  });

  test("a probes-only run reports just the tool-definition overhead", () => {
    const md = renderSummary({ ...input, config: config({ tasks: [], reps: 0 }), records: [] });
    expect(md).toContain("只测了工具定义开销");
    expect(md).toContain("| jev-all | 9,444 | +4844 | answered |");
    expect(md).not.toContain("## Token 效率摘要");
    expect(md).not.toContain("每组重复次数");
  });

  test("an early stop lists the runs that never started", () => {
    const md = renderSummary({ ...input, stopped: "budget", notRun: [{ task: "t1", arm: "baseline", rep: 3 }] });
    expect(md).toContain("提前停止：累计费用达到上限");
    expect(md).toContain("- t1__baseline__3");
  });

  test("metrics json carries the aggregate", () => {
    const json = buildMetricsJson(input);
    expect(Object.keys(json)).toEqual(["config", "probes", "aggregate", "records", "notRun", "stopped"]);
  });
});
