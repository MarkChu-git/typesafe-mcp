import { runId } from "./schedule.ts";
import {
  ARM_IDS,
  type ArmId,
  type EvalConfig,
  type ProbeResult,
  type RunKey,
  type RunRecord,
  type RunStatus,
  type StopReason,
} from "./types.ts";

export interface Stat {
  mean: number;
  min: number;
  max: number;
}

export interface CellStats {
  task: string;
  arm: ArmId;
  /** Runs counted toward the stats. */
  n: number;
  /** Runs left out (invalid, rate_limited, error). */
  excluded: number;
  score: Stat;
  totalTokens: Stat;
  costUsd: Stat;
  /** Tool calls other than the final StructuredOutput call. */
  toolCalls: Stat;
  jevCalls: Stat;
  jevTokens: Stat;
  /** Characters of jev tool arguments plus results per run: what the agent wrote and read for jev. */
  jevChars: Stat;
  peakContext: Stat;
  modelCalls: Stat;
  durationMs: Stat;
  passRate: number;
  /** Share of counted runs with at least one jev call. */
  jevUsageRate: number;
}

export type Verdict =
  | "baseline"
  | "no-baseline"
  | "jev-unused"
  | "fewer-tokens-same-score"
  | "fewer-tokens-lower-score"
  | "more-tokens";

export interface ArmSummary {
  arm: ArmId;
  tasks: number;
  /** Mean over tasks of the per-task mean, so every task weighs the same. */
  meanTokensPerRun: number;
  tokensDeltaPct: number | null;
  meanCostPerRun: number;
  costDeltaPct: number | null;
  meanPeakContext: number;
  peakContextDeltaPct: number | null;
  meanScore: number;
  scoreDelta: number | null;
  /** On every task shared with baseline, mean score ≥ baseline's lowest score. */
  nonInferior: boolean | null;
  /** Mean over tasks of the share of runs that called jev; null for baseline. */
  jevUsageRate: number | null;
  verdict: Verdict;
}

export interface Aggregate {
  cells: CellStats[];
  arms: ArmSummary[];
}

export interface SummaryInput {
  config: EvalConfig;
  probes: readonly ProbeResult[];
  records: readonly RunRecord[];
  notRun: readonly RunKey[];
  stopped: StopReason | null;
  unreviewedTasks?: readonly string[];
}

const EXCLUDED: ReadonlySet<RunStatus> = new Set(["invalid", "rate_limited", "error"]);
const OUTPUT_TOOL = "StructuredOutput";
const EPSILON = 1e-9;
const DIRTY_FILES_SHOWN = 10;

export const isCounted = (r: RunRecord): boolean => !EXCLUDED.has(r.metrics.status);
const isJevCall = (name: string): boolean => name.startsWith("mcp__jev__");
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : sum(xs) / xs.length);

function stat(xs: readonly number[]): Stat {
  if (xs.length === 0) return { mean: 0, min: 0, max: 0 };
  return { mean: mean(xs), min: Math.min(...xs), max: Math.max(...xs) };
}

function cellStats(task: string, arm: ArmId, group: readonly RunRecord[]): CellStats {
  const runs = group.filter(isCounted);
  const toolCounts = runs.map((r) => r.metrics.toolCalls.filter((c) => c.name !== OUTPUT_TOOL).length);
  const jevCounts = runs.map((r) => r.metrics.toolCalls.filter((c) => isJevCall(c.name)).length);
  const share = (k: number) => (runs.length === 0 ? 0 : k / runs.length);
  return {
    task,
    arm,
    n: runs.length,
    excluded: group.length - runs.length,
    score: stat(runs.map((r) => r.score ?? 0)),
    totalTokens: stat(runs.map((r) => r.metrics.totalTokens)),
    costUsd: stat(runs.map((r) => r.metrics.costUsd)),
    toolCalls: stat(toolCounts),
    jevCalls: stat(jevCounts),
    jevTokens: stat(runs.map((r) => r.metrics.jevTokens)),
    jevChars: stat(
      runs.map((r) =>
        r.metrics.toolCalls.filter((c) => isJevCall(c.name)).reduce((s, c) => s + c.argChars + c.resultChars, 0),
      ),
    ),
    peakContext: stat(runs.map((r) => r.metrics.peakContextTokens ?? 0)),
    modelCalls: stat(runs.map((r) => r.metrics.modelCalls)),
    durationMs: stat(runs.map((r) => r.metrics.durationMs)),
    passRate: share(runs.filter((r) => r.passed === true).length),
    jevUsageRate: share(jevCounts.filter((c) => c > 0).length),
  };
}

function summarizeArm(arm: ArmId, cells: readonly CellStats[]): ArmSummary {
  const own = cells.filter((c) => c.arm === arm && c.n > 0);
  const base = new Map(cells.filter((c) => c.arm === "baseline" && c.n > 0).map((c) => [c.task, c]));
  const summary = {
    arm,
    tasks: own.length,
    meanTokensPerRun: mean(own.map((c) => c.totalTokens.mean)),
    meanCostPerRun: mean(own.map((c) => c.costUsd.mean)),
    meanPeakContext: mean(own.map((c) => c.peakContext.mean)),
    meanScore: mean(own.map((c) => c.score.mean)),
    jevUsageRate: arm === "baseline" ? null : mean(own.map((c) => c.jevUsageRate)),
  };
  const none = { tokensDeltaPct: null, costDeltaPct: null, peakContextDeltaPct: null, scoreDelta: null, nonInferior: null };
  if (arm === "baseline") return { ...summary, ...none, verdict: "baseline" };
  const pairs = own.flatMap((c) => {
    const b = base.get(c.task);
    return b ? [{ c, b }] : [];
  });
  if (pairs.length === 0) return { ...summary, ...none, verdict: "no-baseline" };
  const deltaPct = (pick: (c: CellStats) => number): number | null => {
    const reference = sum(pairs.map((p) => pick(p.b)));
    return reference > 0 ? (sum(pairs.map((p) => pick(p.c))) / reference - 1) * 100 : null;
  };
  const tokensDeltaPct = deltaPct((c) => c.totalTokens.mean);
  const costDeltaPct = deltaPct((c) => c.costUsd.mean);
  const peakContextDeltaPct = deltaPct((c) => c.peakContext.mean);
  const scoreDelta = mean(pairs.map((p) => p.c.score.mean)) - mean(pairs.map((p) => p.b.score.mean));
  const nonInferior = pairs.every((p) => p.c.score.mean + EPSILON >= p.b.score.min);
  const fewer = tokensDeltaPct !== null && tokensDeltaPct < 0;
  // Without a single jev call, any difference is tool-definition overhead plus run-to-run noise.
  const verdict: Verdict =
    summary.jevUsageRate === 0
      ? "jev-unused"
      : !fewer
        ? "more-tokens"
        : nonInferior
          ? "fewer-tokens-same-score"
          : "fewer-tokens-lower-score";
  return { ...summary, tokensDeltaPct, costDeltaPct, peakContextDeltaPct, scoreDelta, nonInferior, verdict };
}

export function aggregate(records: readonly RunRecord[]): Aggregate {
  const groups = new Map<string, { task: string; arm: ArmId; runs: RunRecord[] }>();
  for (const r of records) {
    const key = `${r.task}\u0000${r.arm}`;
    const g = groups.get(key);
    if (g) g.runs.push(r);
    else groups.set(key, { task: r.task, arm: r.arm, runs: [r] });
  }
  const cells = [...groups.values()].map((g) => cellStats(g.task, g.arm, g.runs));
  const present = new Set(cells.map((c) => c.arm));
  const arms = ARM_IDS.filter((a) => present.has(a)).map((a) => summarizeArm(a, cells));
  return { cells, arms };
}

const VERDICT_LABEL: Record<Verdict, string> = {
  baseline: "基线",
  "no-baseline": "无基线",
  "jev-unused": "没调用 jev，差异来自工具定义和波动",
  "fewer-tokens-same-score": "更省且不降分",
  "fewer-tokens-lower-score": "更省但降分",
  "more-tokens": "更费",
};

const STOP_LABEL: Record<StopReason, string> = {
  budget: "累计费用达到上限",
  quota: "订阅窗口用量达到阈值",
  rate_limited: "遇到订阅限额",
};

const int = (n: number): string => Math.round(n).toLocaleString("en-US");
const pct = (p: number | null): string => (p === null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);
const signed = (d: number | null, digits = 2): string => (d === null ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(digits)}`);
const usd = (n: number): string => `$${n.toFixed(3)}`;
const ranged = (s: Stat, f: (n: number) => string): string => `${f(s.mean)} [${f(s.min)}–${f(s.max)}]`;
const score2 = (n: number): string => n.toFixed(2);
const share = (n: number): string => `${Math.round(n * 100)}%`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

function headerLines(input: SummaryInput): string[] {
  const c = input.config;
  const actual = [...new Set(input.records.map((r) => r.metrics.model).filter((m): m is string => m !== null))];
  const lines = [
    "# 评测报告",
    "",
    `- 模型：${c.model}${actual.length > 0 ? `（实际：${actual.join("、")}）` : ""}`,
    `- Claude Code：${c.cliVersion}`,
    `- Effort：${c.effort ?? "默认"}`,
    `- Git 提交：${c.gitCommit.slice(0, 12)}${c.gitDirtyFiles.length > 0 ? "（工作区有未提交的改动）" : ""}`,
    `- 生成时间：${c.createdAt}`,
    c.tasks.length === 0 ? "- 只测了工具定义开销（`--probes-only`）" : `- 每组重复次数：${c.reps}`,
  ];
  if (c.gitDirtyFiles.length > 0) {
    const shown = c.gitDirtyFiles.slice(0, DIRTY_FILES_SHOWN).map((f) => `- \`${f}\``);
    const more = c.gitDirtyFiles.length - DIRTY_FILES_SHOWN;
    lines.push("", "未提交的改动：", ...shown, ...(more > 0 ? [`- 另有 ${more} 个文件`] : []));
  }
  if (input.unreviewedTasks && input.unreviewedTasks.length > 0) {
    lines.push(
      "",
      `> 注意：包含未经人工复核的任务（${input.unreviewedTasks.join("、")}），这次的结果不能用来下结论。`,
    );
  }
  lines.push("", "费用按 API 标价折算，用来比较消耗，不是订阅的实际扣费。");
  return lines;
}

/** Fewest counted runs in any task × arm cell; below this many, small differences are noise. */
const STABLE_RUNS = 3;

function efficiencySection(agg: Aggregate, hasBaseline: boolean): string[] {
  const lines = ["", "## Token 效率摘要", ""];
  if (!hasBaseline) lines.push("缺少基线，只列绝对值。", "");
  const counted = agg.cells.filter((c) => c.n > 0).map((c) => c.n);
  const fewest = counted.length === 0 ? 0 : Math.min(...counted);
  if (fewest > 0 && fewest < STABLE_RUNS) {
    lines.push(
      `> 每个任务每组最少只有 ${fewest} 次运行，几个百分点的差异可能只是随机波动；下结论前用 \`--reps ${STABLE_RUNS}\` 或更多。`,
      "",
    );
  }
  const usage = (a: ArmSummary): string => (a.jevUsageRate === null ? "—" : share(a.jevUsageRate));
  const header = hasBaseline
    ? ["组别", "平均 token/次", "相对 baseline", "平均费用/次", "相对 baseline", "峰值上下文", "相对 baseline", "平均得分", "得分变化", "jev 使用率", "结论"]
    : ["组别", "平均 token/次", "平均费用/次", "峰值上下文", "平均得分", "jev 使用率"];
  const rows = agg.arms.map((a) =>
    hasBaseline
      ? [
          a.arm,
          int(a.meanTokensPerRun),
          pct(a.tokensDeltaPct),
          usd(a.meanCostPerRun),
          pct(a.costDeltaPct),
          int(a.meanPeakContext),
          pct(a.peakContextDeltaPct),
          score2(a.meanScore),
          signed(a.scoreDelta),
          usage(a),
          VERDICT_LABEL[a.verdict],
        ]
      : [a.arm, int(a.meanTokensPerRun), usd(a.meanCostPerRun), int(a.meanPeakContext), score2(a.meanScore), usage(a)],
  );
  return [...lines, ...table(header, rows)];
}

function probeSection(probes: readonly ProbeResult[]): string[] {
  const lines = ["", "## 工具定义开销", ""];
  if (probes.length === 0) return [...lines, "没有探测结果。"];
  const base = probes.find((p) => p.arm === "baseline")?.contextTokens ?? null;
  const rows = probes.map((p) => [
    p.arm,
    p.contextTokens === null ? "—" : int(p.contextTokens),
    p.arm === "baseline" || base === null || p.contextTokens === null ? "—" : signed(p.contextTokens - base, 0),
    p.status,
  ]);
  return [...lines, ...table(["组别", "第一轮上下文 token", "相对 baseline", "状态"], rows)];
}

function taskSections(agg: Aggregate, hasBaseline: boolean): string[] {
  const lines = ["", "## 各任务明细"];
  const tasks = [...new Set(agg.cells.map((c) => c.task))];
  for (const task of tasks) {
    const cells = agg.cells.filter((c) => c.task === task);
    const base = cells.find((c) => c.arm === "baseline" && c.n > 0);
    const header = [
      "组别",
      "次数",
      "得分 [最小–最大]",
      "token [最小–最大]",
      ...(hasBaseline ? ["相对 baseline"] : []),
      "峰值上下文 [最小–最大]",
      "模型调用",
      "费用",
      "工具调用",
      "jev 使用率",
      "jev 参数+返回（字符）",
      "耗时",
    ];
    const rows = ARM_IDS.flatMap((arm) => {
      const c = cells.find((x) => x.arm === arm);
      if (!c) return [];
      const delta =
        !base || c.arm === "baseline" || c.n === 0 || base.totalTokens.mean === 0
          ? null
          : (c.totalTokens.mean / base.totalTokens.mean - 1) * 100;
      return [
        [
          arm,
          c.excluded > 0 ? `${c.n}（另有 ${c.excluded} 次未计入）` : String(c.n),
          ranged(c.score, score2),
          ranged(c.totalTokens, int),
          ...(hasBaseline ? [pct(delta)] : []),
          ranged(c.peakContext, int),
          c.modelCalls.mean.toFixed(1),
          usd(c.costUsd.mean),
          c.toolCalls.mean.toFixed(1),
          arm === "baseline" ? "—" : share(c.jevUsageRate),
          arm === "baseline" ? "—" : int(c.jevChars.mean),
          `${(c.durationMs.mean / 1000).toFixed(1)}s`,
        ],
      ];
    });
    lines.push("", `### ${task}`, "", ...table(header, rows));
  }
  return lines;
}

function leftoverSections(input: SummaryInput): string[] {
  const excluded = input.records.filter((r) => !isCounted(r));
  const lines = ["", "## 未计入的运行", ""];
  lines.push(...(excluded.length === 0 ? ["无"] : excluded.map((r) => `- ${runId(r)}：${r.metrics.status}${r.metrics.errorMessage ? `（${r.metrics.errorMessage}）` : ""}`)));
  lines.push("", "## 未执行的运行", "");
  if (input.stopped) lines.push(`提前停止：${STOP_LABEL[input.stopped]}。可以用 \`--resume\` 续跑。`, "");
  lines.push(...(input.notRun.length === 0 ? ["无"] : input.notRun.map((k) => `- ${runId(k)}`)));
  return lines;
}

/** Markdown report; token efficiency comes first because it is the project's primary metric. */
export function renderSummary(input: SummaryInput): string {
  if (input.config.tasks.length === 0) return [...headerLines(input), ...probeSection(input.probes), ""].join("\n");
  const agg = aggregate(input.records);
  const hasBaseline = agg.cells.some((c) => c.arm === "baseline" && c.n > 0);
  return [
    ...headerLines(input),
    ...efficiencySection(agg, hasBaseline),
    ...probeSection(input.probes),
    ...taskSections(agg, hasBaseline),
    ...leftoverSections(input),
    "",
  ].join("\n");
}

export function buildMetricsJson(input: SummaryInput): Record<string, unknown> {
  return {
    config: input.config,
    probes: input.probes,
    aggregate: aggregate(input.records),
    records: input.records,
    notRun: input.notRun,
    stopped: input.stopped,
  };
}
