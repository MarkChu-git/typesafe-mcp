// Shared contracts for the eval harness.
// Design: openspec/changes/add-agent-tool-eval/design.md (D2–D12).

export const ARM_IDS = ["baseline", "jev", "jev-directed", "jev-all", "jev-v0.1.1"] as const;
export type ArmId = (typeof ARM_IDS)[number];

export const JEV_TOOLS = ["jev_ask", "jev_check", "jev_classify", "jev_score", "jev_models"] as const;
export type JevTool = (typeof JEV_TOOLS)[number];

export interface JevServer {
  /** The jev tools the agent may see. */
  allow: readonly JevTool[];
  /** Extra env for the server process, merged into what Claude Code passes on. */
  env?: Record<string, string>;
  /** Run the server from this git ref (a release tag) instead of the working tree. */
  ref?: string;
}

export interface Arm {
  id: ArmId;
  /** `false` = no jev MCP server. */
  jev: false | JevServer;
  /** Appended after the shared eval instructions. */
  extraPrompt?: string;
}

export type Split = "dev" | "holdout";

export const RUN_STATUSES = [
  "answered",
  "no_answer",
  "max_turns",
  "budget_exceeded",
  "timeout",
  "rate_limited",
  "invalid",
  "error",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Runs with these statuses are re-run on `--resume` and never count toward results. */
export const RETRYABLE_STATUSES: readonly RunStatus[] = ["rate_limited", "error"];

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface ToolCallRecord {
  /** Name as the agent saw it, e.g. `Read` or `mcp__jev__jev_ask`. */
  name: string;
  /** `JSON.stringify(input).length` of the tool_use block. */
  argChars: number;
  /** Text length of the matching tool_result (0 if none arrived). */
  resultChars: number;
  isError: boolean;
  /** Receipt-time gap between the tool_use event and its tool_result event; null if unmatched. */
  latencyMs: number | null;
  /** Jev input tokens reported by a jev tool (`_meta`, or the result JSON for 0.1.x); null otherwise. */
  jevInputTokens: number | null;
}

/** Last `rate_limit_event.rate_limit_info` seen in the stream. */
export interface QuotaInfo {
  status: string;
  fiveHourUtilization: number | null;
  sevenDayUtilization: number | null;
  /** Epoch seconds. */
  resetsAt: number | null;
}

export interface StreamLine {
  /** `Date.now()` when the line was read from the child's stdout. */
  receivedAt: number;
  raw: string;
}

export interface RunMetrics {
  status: RunStatus;
  model: string | null;
  cliVersion: string | null;
  /** Tool names from the `system/init` event, sorted. */
  tools: string[];
  turns: number;
  durationMs: number;
  /** `result.total_cost_usd` — API list-price equivalent, not the subscription charge. */
  costUsd: number;
  /** From `result.modelUsage`, keyed by model id. */
  usageByModel: Record<string, TokenUsage>;
  /** Sum over models of input + output + cacheWrite + cacheRead. The primary efficiency metric. */
  totalTokens: number;
  toolCalls: ToolCallRecord[];
  toolErrors: number;
  /** Sum of `jevInputTokens`. */
  jevTokens: number;
  /** input + cacheWrite + cacheRead of the first model call. Used by probes (design D7). */
  firstTurnContextTokens: number | null;
  /** Largest input + cacheWrite + cacheRead of any single model call: how full the context got. */
  peakContextTokens: number | null;
  /** Distinct model calls (assistant message ids). */
  modelCalls: number;
  /** `result.structured_output`; null when absent. */
  structuredOutput: unknown;
  terminalReason: string | null;
  quota: QuotaInfo | null;
  errorMessage: string | null;
}

export interface RunKey {
  task: string;
  arm: ArmId;
  /** 1-based. */
  rep: number;
}

export interface RunRecord extends RunKey {
  metrics: RunMetrics;
  /** Null unless the status is `answered` and the answer validated. */
  score: number | null;
  passed: boolean | null;
  feedback: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface ProbeResult {
  arm: ArmId;
  contextTokens: number | null;
  tools: string[];
  status: RunStatus;
}

export interface EvalConfig {
  model: string;
  effort: string | null;
  arms: ArmId[];
  tasks: string[];
  reps: number;
  maxTurns: number;
  maxRunUsd: number;
  maxTotalUsd: number;
  timeoutMin: number;
  concurrency: number;
  stopAtUtilization: number;
  cliVersion: string;
  gitCommit: string;
  gitDirtyFiles: string[];
  createdAt: string;
}

export type StopReason = "budget" | "quota" | "rate_limited";
