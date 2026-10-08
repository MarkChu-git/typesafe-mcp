import { describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalConfig, RunRecord, StreamLine } from "../../evals/harness/types.ts";
import {
  resultsDirName,
  writeJson,
  readJson,
  writeConfig,
  readConfig,
  writeRun,
  readDone,
  gitInfo,
} from "../../evals/harness/results.ts";

describe("resultsDirName", () => {
  test("formats model and timestamp correctly", () => {
    const date = new Date("2026-10-08T12:34:56.789Z");
    const result = resultsDirName("claude-sonnet-5-5", date);
    expect(result).toMatch(/^\d{8}T\d{6}Z-/);
    expect(result).toContain("sonnet");
  });

  test("sanitizes model name", () => {
    const date = new Date("2026-10-08T12:34:56.789Z");
    const result = resultsDirName("Claude-Opus-5.5", date);
    expect(result).toContain("opus");
    expect(result).not.toContain("Claude");
  });
});

describe("writeJson/readJson", () => {
  test("round-trip JSON data", async () => {
    const tmpDir = tmpdir();
    const testDir = join(tmpDir, `test-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    try {
      const data = { key: "value", nested: { num: 42 } };
      const path = join(testDir, "test.json");

      await writeJson(path, data);
      const read = await readJson<typeof data>(path);

      expect(read).toEqual(data);
    } finally {
      await Bun.spawn(["rm", "-rf", testDir]).exited;
    }
  });
});

describe("writeConfig/readConfig", () => {
  test("round-trip config data", async () => {
    const tmpDir = tmpdir();
    const testDir = join(tmpDir, `test-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    try {
      const config: EvalConfig = {
        model: "sonnet",
        effort: null,
        arms: ["baseline"],
        tasks: ["task1"],
        reps: 3,
        maxTurns: 40,
        maxRunUsd: 2,
        maxTotalUsd: 30,
        timeoutMin: 15,
        concurrency: 1,
        stopAtUtilization: 0.85,
        cliVersion: "2.1.284",
        gitCommit: "abc123",
        gitDirtyFiles: [],
        createdAt: new Date().toISOString(),
      };

      await writeConfig(testDir, config);
      const read = await readConfig(testDir);

      expect(read.model).toBe("sonnet");
      expect(read.arms).toEqual(["baseline"]);
    } finally {
      await Bun.spawn(["rm", "-rf", testDir]).exited;
    }
  });
});

describe("writeRun", () => {
  test("writes run record with redacted secrets", async () => {
    const tmpDir = tmpdir();
    const testDir = join(tmpDir, `test-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    try {
      const record: RunRecord = {
        task: "test-task",
        arm: "baseline",
        rep: 1,
        metrics: {
          status: "answered",
          model: "sonnet",
          cliVersion: "2.1.284",
          tools: ["Read", "Grep"],
          turns: 2,
          durationMs: 1000,
          costUsd: 0.5,
          usageByModel: { sonnet: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0 } },
          totalTokens: 150,
          toolCalls: [],
          toolErrors: 0,
          jevTokens: 0,
          firstTurnContextTokens: 100,
          peakContextTokens: 100,
          modelCalls: 2,
          structuredOutput: { answer: "yes" },
          terminalReason: "endTurn",
          quota: null,
          errorMessage: null,
        },
        score: 1,
        passed: true,
        feedback: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };

      const lines: StreamLine[] = [
        { receivedAt: Date.now(), raw: JSON.stringify({ type: "test", note: "planted-12345678" }) },
      ];

      await writeRun(testDir, record, lines, ["planted-12345678"]);

      // Check that redaction happened
      const jsonContent = await readFile(join(testDir, "runs", "test-task__baseline__1.json"), "utf-8");
      expect(jsonContent).not.toContain("planted-");

      const jsonlContent = await readFile(
        join(testDir, "runs", "test-task__baseline__1.jsonl"),
        "utf-8",
      );
      expect(jsonlContent).toContain("***");
      expect(jsonlContent).not.toContain("planted-");
    } finally {
      await Bun.spawn(["rm", "-rf", testDir]).exited;
    }
  });
});

describe("readDone", () => {
  test("reads run statuses from directory", async () => {
    const tmpDir = tmpdir();
    const testDir = join(tmpDir, `test-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    try {
      const record: RunRecord = {
        task: "test-task",
        arm: "baseline",
        rep: 1,
        metrics: {
          status: "answered",
          model: "sonnet",
          cliVersion: "2.1.284",
          tools: [],
          turns: 1,
          durationMs: 100,
          costUsd: 0.1,
          usageByModel: {},
          totalTokens: 50,
          toolCalls: [],
          toolErrors: 0,
          jevTokens: 0,
          firstTurnContextTokens: null,
        peakContextTokens: null,
        modelCalls: 0,
          structuredOutput: null,
          terminalReason: null,
          quota: null,
          errorMessage: null,
        },
        score: null,
        passed: null,
        feedback: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };

      await writeRun(testDir, record, [], []);

      const done = await readDone(testDir);
      expect(done.has("test-task__baseline__1")).toBe(true);
      expect(done.get("test-task__baseline__1")).toBe("answered");
    } finally {
      await Bun.spawn(["rm", "-rf", testDir]).exited;
    }
  });
});

describe("gitInfo", () => {
  test("returns current working directory git info", async () => {
    const info = await gitInfo(process.cwd());
    expect(info.commit).toBeTruthy();
    expect(Array.isArray(info.dirtyFiles)).toBe(true);
  });
});
