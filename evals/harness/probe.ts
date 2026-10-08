import type { ArmId, ProbeResult, RunMetrics } from "./types.ts";

/** A run that calls no tools, so its first request measures system prompt + tool definitions. */
export const PROBE_PROMPT = 'Do not call any tools. Return answer "OK" as structured output.';

export const PROBE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

export function toProbeResult(arm: ArmId, m: RunMetrics): ProbeResult {
  return { arm, contextTokens: m.firstTurnContextTokens, tools: m.tools, status: m.status };
}
