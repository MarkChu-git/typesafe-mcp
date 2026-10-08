import type { EvalConfig, RunKey, RunMetrics, RunRecord } from "../../evals/harness/types.ts";

export function metrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    status: "answered",
    model: "claude-sonnet-5-5",
    cliVersion: "2.1.284",
    tools: [],
    turns: 3,
    durationMs: 1_000,
    costUsd: 0.1,
    usageByModel: {},
    totalTokens: 1_000,
    toolCalls: [],
    toolErrors: 0,
    jevTokens: 0,
    firstTurnContextTokens: null,
    peakContextTokens: 5_000,
    modelCalls: 3,
    structuredOutput: {},
    terminalReason: "completed",
    quota: null,
    errorMessage: null,
    ...over,
  };
}

export function record(key: RunKey, over: Partial<RunMetrics> = {}, score: number | null = 1): RunRecord {
  return {
    ...key,
    metrics: metrics(over),
    score,
    passed: score === null ? null : score >= 0.8,
    feedback: null,
    startedAt: "2026-10-08T00:00:00.000Z",
    finishedAt: "2026-10-08T00:01:00.000Z",
  };
}

export function config(over: Partial<EvalConfig> = {}): EvalConfig {
  return {
    model: "sonnet",
    effort: null,
    arms: ["baseline", "jev-all"],
    tasks: ["t1", "t2"],
    reps: 2,
    maxTurns: 40,
    maxRunUsd: 2,
    maxTotalUsd: 30,
    timeoutMin: 15,
    concurrency: 1,
    stopAtUtilization: 0.85,
    cliVersion: "2.1.284",
    gitCommit: "0123456789abcdef",
    gitDirtyFiles: [],
    createdAt: "2026-10-08T00:00:00.000Z",
    ...over,
  };
}
