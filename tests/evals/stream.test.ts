import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARMS, expectedTools, SDK_SKILL } from "../../evals/arms.ts";
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

  test("a skill list that does not match the arm makes the run invalid", () => {
    const m = parseRun(lines("answered-read.jsonl"), {
      expectedTools: expectedTools(ARMS.baseline),
      expectedSkills: [SDK_SKILL],
      timedOut: false,
      exitCode: 0,
    });
    expect(m.status).toBe("invalid");
    expect(m.errorMessage).toContain("skill list mismatch");
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

const toolUse = (id: string, name: string, input: Record<string, unknown>, i: number): StreamLine => ({
  receivedAt: 1_000 + i,
  raw: JSON.stringify({
    type: "assistant",
    message: { id: `m${id}`, model: "claude-sonnet-5-5", content: [{ type: "tool_use", id, name, input }] },
  }),
});

const turn = (id: string, context: number, name: string, i: number): StreamLine => ({
  receivedAt: 1_000 + i,
  raw: JSON.stringify({
    type: "assistant",
    message: {
      id: `m${id}`,
      model: "claude-sonnet-5-5",
      usage: { input_tokens: context },
      content: [{ type: "tool_use", id, name, input: {} }],
    },
  }),
});

describe("jev calls", () => {
  test("records the context of the model call that first used Jev", () => {
    const ctx = { expectedTools: expectedTools(ARMS.jev), timedOut: false, exitCode: 0 };
    const used = parseRun(
      [turn("1", 4_000, "Read", 0), turn("2", 9_000, "mcp__jev__jev_ask", 1), turn("3", 12_000, "mcp__jev__jev_ask", 2)],
      ctx,
    );
    expect(used.firstJevContextTokens).toBe(9_000);
    expect(parseRun([turn("1", 4_000, "Read", 0)], ctx).firstJevContextTokens).toBeNull();
  });

  test("writing and running TypeSafe SDK code uses Jev; other scripts and reads do not", () => {
    const calls: [string, Record<string, unknown>][] = [
      ["Write", { file_path: "/w/audit.ts", content: 'import { TypeSafeClient } from "@typesafe-ai/sdk";' }],
      ["Bash", { command: "bun audit.ts > answers.json" }],
      ["Bash", { command: "bun --version" }],
      ["Bash", { command: `bun -e 'await fetch("https://api.typesafe.ai/v1/systemone")'` }],
      ["Write", { file_path: "/w/count.ts", content: "console.log(1)" }],
      ["Read", { file_path: "/w/audit.ts" }],
    ];
    const m = parseRun(
      calls.map(([name, input], i) => toolUse(String(i), name, input, i)),
      { expectedTools: expectedTools(ARMS["sdk-directed"]), timedOut: false, exitCode: 0 },
    );
    expect(m.toolCalls.map((c) => c.jev)).toEqual([true, true, false, true, false, false]);
  });

  test("looking at the SDK is not using it: only code that imports it or calls the API is, and only running a script counts", () => {
    const calls: [string, Record<string, unknown>][] = [
      ["Bash", { command: "ls node_modules/@typesafe-ai/sdk && cat node_modules/@typesafe-ai/sdk/dist/index.d.mts" }],
      ["Write", { file_path: "/w/notes.md", content: "Try @typesafe-ai/sdk for the policy check." }],
      ["Write", { file_path: "/w/a.ts", content: "import { TypeSafeClient } from '@typesafe-ai/sdk';" }],
      ["Bash", { command: "bun data.ts" }],
      ["Bash", { command: "sed -i 's/k/K/' a.ts" }],
      ["Bash", { command: "cd /w && bun run ./a.ts > out.json" }],
      ["Edit", { file_path: "/w/judge.ts", old_string: "//", new_string: 'const sdk = await import("@typesafe-ai/sdk");' }],
      ["Bash", { command: "node judge.ts" }],
      ["Bash", { command: "cat > ask.mts <<'EOF'\nimport { TypeSafeClient } from \"@typesafe-ai/sdk\";\nEOF" }],
      ["Bash", { command: "bun ask.mts 2>&1 | head" }],
      ["Bash", { command: "curl -s https://api.typesafe.ai/v1/systemone -d @req.json" }],
    ];
    const m = parseRun(
      calls.map(([name, input], i) => toolUse(String(i), name, input, i)),
      { expectedTools: expectedTools(ARMS["sdk-directed"]), timedOut: false, exitCode: 0 },
    );
    expect(m.toolCalls.map((c) => c.jev)).toEqual([false, false, true, false, false, true, true, true, true, true, true]);
  });

  test("jev MCP calls use Jev", () => {
    const m = parse("jev-ask-meta.jsonl", "jev");
    expect(m.toolCalls.filter((c) => c.name.startsWith("mcp__jev__")).every((c) => c.jev)).toBe(true);
    expect(m.toolCalls.some((c) => c.jev)).toBe(true);
  });
});
