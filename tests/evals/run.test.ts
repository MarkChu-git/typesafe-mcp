import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type MainDeps } from "../../evals/run.ts";
import type { Split } from "../../evals/harness/types.ts";
import type { RegisteredTask } from "../../evals/tasks/types.ts";

function fakeTask(id: string, split: Split, reviewed: boolean): RegisteredTask {
  return {
    id,
    title: id,
    category: "triage",
    split,
    dir: `/tasks/${id}`,
    prompt: "do it",
    workspaceDir: `/tasks/${id}/workspace`,
    reviewed,
    jsonSchema: () => ({ type: "object" }),
    parse: () => ({ ok: false, error: "unused" }),
    gold: () => ({}),
    score: () => ({ score: 1, passed: true }),
  };
}

const roots: string[] = [];
const tempRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function harness() {
  const log: string[] = [];
  const calls = { claude: 0, exec: 0 };
  const deps: MainDeps = {
    runClaude: async () => {
      calls.claude += 1;
      throw new Error("must not start claude");
    },
    exec: async () => {
      calls.exec += 1;
      throw new Error("must not run commands");
    },
    tasks: [fakeTask("t1", "dev", true), fakeTask("t2", "dev", false), fakeTask("t3", "holdout", true)],
    env: {},
    resultsRoot: tempRoot("eval-run-test-"),
    serversRoot: tempRoot("eval-run-servers-"),
    now: () => new Date("2026-10-08T00:00:00.000Z"),
    log: (line) => log.push(line),
  };
  return { deps, log, calls, text: () => log.join("\n") };
}

describe("eval CLI", () => {
  test("dry run prints the matrix and starts nothing", async () => {
    const h = harness();
    const code = await main(["--dry-run", "--tasks", "t1", "--arms", "baseline,jev-all", "--reps", "3"], h.deps);
    expect(code).toBe(0);
    expect(h.text()).toContain("runs: 6 task runs + 2 probes");
    expect(h.text()).toContain("t1__jev-all__3");
    expect(h.text()).toContain("Nothing was started.");
    expect(h.calls).toEqual({ claude: 0, exec: 0 });
  });

  test("unknown task or arm ids exit with 2 before anything starts", async () => {
    const h = harness();
    expect(await main(["--tasks", "nope"], h.deps)).toBe(2);
    expect(h.text()).toContain("unknown task id: nope");
    expect(await main(["--arms", "baseline,typo"], h.deps)).toBe(2);
    expect(h.text()).toContain("unknown arm id: typo");
    expect(h.calls).toEqual({ claude: 0, exec: 0 });
  });

  test("unreviewed tasks are refused unless explicitly allowed", async () => {
    const h = harness();
    expect(await main(["--tasks", "t2"], h.deps)).toBe(2);
    expect(h.text()).toContain("not reviewed yet: t2");
    expect(h.calls.exec).toBe(0);
    expect(await main(["--tasks", "t2", "--allow-unreviewed", "--dry-run"], h.deps)).toBe(0);
    expect(h.text()).toContain("t2 (not reviewed)");
  });

  test("by default the arms are baseline, jev and the last release", async () => {
    const h = harness();
    expect(await main(["--dry-run", "--tasks", "t1", "--reps", "1"], h.deps)).toBe(0);
    expect(h.text()).toContain("arms: baseline, jev, jev-v0.1.1; reps: 1");
  });

  test("probes-only needs no tasks and cannot resume", async () => {
    const h = harness();
    expect(await main(["--dry-run", "--probes-only", "--arms", "baseline,jev,jev-all"], h.deps)).toBe(0);
    expect(h.text()).toContain("runs: 0 task runs + 3 probes");
    expect(await main(["--probes-only", "--resume", "/nowhere"], h.deps)).toBe(2);
    expect(h.calls).toEqual({ claude: 0, exec: 0 });
  });

  test("the default split is dev, so holdout tasks need to be asked for", async () => {
    const h = harness();
    expect(await main(["--dry-run", "--allow-unreviewed", "--arms", "baseline", "--reps", "1"], h.deps)).toBe(0);
    expect(h.text()).toContain("tasks: t1, t2 (not reviewed)");
    expect(h.text()).not.toContain("t3__baseline__1");
  });
});
