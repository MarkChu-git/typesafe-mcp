import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARMS, expectedTools } from "../../evals/arms.ts";
import { toProbeResult } from "../../evals/harness/probe.ts";
import { parseRun } from "../../evals/harness/stream.ts";
import type { ArmId, StreamLine } from "../../evals/harness/types.ts";

const dir = join(import.meta.dir, "fixtures", "streams");
const raw = (file: string): string[] => readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean);
const lines = (file: string): StreamLine[] => raw(file).map((r, i) => ({ receivedAt: 1_000 + i * 100, raw: r }));
/** Tools of the ask + models arm that recorded `jev-tool-error.jsonl` with v0.1.1. */
const ASK_AND_MODELS = ["Glob", "Grep", "Read", "StructuredOutput", "mcp__jev__jev_ask", "mcp__jev__jev_models"];
const parse = (file: string, arm: ArmId | readonly string[], timedOut = false) =>
  parseRun(lines(file), {
    expectedTools: typeof arm === "string" ? expectedTools(ARMS[arm]) : arm,
    timedOut,
    exitCode: 0,
  });

describe("parseRun status", () => {
  test.each([
    ["answered-read.jsonl", "baseline", "answered"],
    ["probe-baseline.jsonl", "baseline", "answered"],
    ["init-jev-all.jsonl", "jev-all", "answered"],
    ["jev-tool-error.jsonl", ASK_AND_MODELS, "answered"],
    ["jev-ask-meta.jsonl", "jev", "answered"],
    ["jev-ask-two-calls.jsonl", "jev-all", "answered"],
    ["max-turns.jsonl", "baseline", "max_turns"],
    ["budget.jsonl", "baseline", "budget_exceeded"],
    ["not-logged-in.jsonl", "jev-all", "error"],
    ["rate-limited.jsonl", "baseline", "rate_limited"],
    ["no-answer.jsonl", "baseline", "no_answer"],
  ] as const)("%s as %s → %s", (file, arm, status) => {
    expect(parse(file, arm).status).toBe(status);
  });

  test("a tool list that does not match the arm makes the run invalid", () => {
    const m = parse("init-jev-all.jsonl", "baseline");
    expect(m.status).toBe("invalid");
    expect(m.errorMessage).toContain("tool list mismatch");
  });

  test("timeout wins over everything but invalid", () => {
    expect(parse("answered-read.jsonl", "baseline", true).status).toBe("timeout");
  });

  test("no output at all is invalid", () => {
    const m = parseRun([], { expectedTools: expectedTools(ARMS.baseline), timedOut: false, exitCode: 1 });
    expect(m.status).toBe("invalid");
    expect(m.errorMessage).toBe("no init event");
  });
});

describe("parseRun metrics", () => {
  test("first-turn context measures tool definition overhead", () => {
    expect(parse("init-jev-all.jsonl", "jev-all").firstTurnContextTokens).toBe(9444);
    expect(parse("probe-baseline.jsonl", "baseline").firstTurnContextTokens).toBe(4600);
    expect(toProbeResult("baseline", parse("probe-baseline.jsonl", "baseline"))).toMatchObject({
      arm: "baseline",
      contextTokens: 4600,
      status: "answered",
    });
  });

  test("synthetic assistant messages do not count as the first turn", () => {
    const m = parse("not-logged-in.jsonl", "jev-all");
    expect(m.firstTurnContextTokens).toBeNull();
    expect(m.errorMessage).toContain("Not logged in");
  });

  test("jev usage comes from _meta, which the agent never sees", () => {
    const m = parse("jev-ask-meta.jsonl", "jev");
    const ask = m.toolCalls.find((c) => c.name === "mcp__jev__jev_ask");
    expect(ask).toMatchObject({ jevInputTokens: 340, isError: false });
    expect(m.jevTokens).toBe(340);
    // resultChars is what the model read: the concise answers, without usage.
    expect(ask?.resultChars).toBe('{"answers":{"q":{"answer":true,"certainty":0.9,"decision":"act"}}}'.length);
  });

  test("jev usage is summed across calls (v0.1.1 reported it in the result JSON)", () => {
    const m = parse("jev-ask-two-calls.jsonl", "jev-all");
    const asks = m.toolCalls.filter((c) => c.name === "mcp__jev__jev_ask");
    expect(asks).toHaveLength(2);
    expect(asks.map((c) => c.jevInputTokens)).toEqual([423, 380]);
    expect(m.jevTokens).toBe(803);
    expect(asks.every((c) => c.latencyMs === 100 && c.argChars > 0 && c.resultChars > 0)).toBe(true);
  });

  test("tool errors are counted", () => {
    const m = parse("jev-tool-error.jsonl", ASK_AND_MODELS);
    expect(m.toolErrors).toBe(1);
    expect(m.toolCalls.find((c) => c.name === "mcp__jev__jev_models")).toMatchObject({
      isError: true,
      jevInputTokens: null,
    });
  });

  test("total tokens come from result.modelUsage", () => {
    const result = raw("answered-read.jsonl")
      .map((r) => JSON.parse(r) as { type: string; modelUsage?: Record<string, Record<string, number>> })
      .find((e) => e.type === "result");
    const expected = Object.values(result?.modelUsage ?? {}).reduce(
      (s, u) =>
        s +
        (u.inputTokens ?? 0) +
        (u.outputTokens ?? 0) +
        (u.cacheCreationInputTokens ?? 0) +
        (u.cacheReadInputTokens ?? 0),
      0,
    );
    const m = parse("answered-read.jsonl", "baseline");
    expect(expected).toBeGreaterThan(0);
    expect(m.totalTokens).toBe(expected);
    expect(m.costUsd).toBeGreaterThan(0);
    expect(m.quota).toMatchObject({ status: "allowed", fiveHourUtilization: 0.01 });
    expect(m.structuredOutput).toEqual({ answer: "ticket" });
    expect(m.modelCalls).toBe(2);
    expect(m.peakContextTokens).toBe(6725);
  });
});
