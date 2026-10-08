import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARMS } from "../../evals/arms.ts";
import {
  buildArgs,
  buildEnv,
  claudeProjectDir,
  compareVersions,
  preflight,
  removeClaudeProjectDir,
  runClaude,
} from "../../evals/harness/claude.ts";

const mockSchema = { type: "object", properties: { answer: { type: "string" } } };

describe("buildArgs", () => {
  test("baseline arm generates correct args", () => {
    const args = buildArgs({
      prompt: "test prompt",
      arm: ARMS.baseline,
      mcpConfigPath: "/tmp/mcp.json",
      jsonSchema: mockSchema,
      model: "sonnet",
      effort: null,
      maxTurns: 40,
      maxBudgetUsd: 2,
    });

    expect(args).toContain("-p");
    expect(args).toContain("test prompt");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--restricted");
    expect(args).toContain("--tools");
    expect(args).toContain("Read,Grep,Glob");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
  });

  test("jev-all arm allows all jev tools", () => {
    const args = buildArgs({
      prompt: "test",
      arm: ARMS["jev-all"],
      mcpConfigPath: "/tmp/mcp.json",
      jsonSchema: mockSchema,
      model: "sonnet",
      effort: null,
      maxTurns: 40,
      maxBudgetUsd: 2,
    });

    expect(args).toContain("--allowedTools");
    expect(args).toContain("mcp__jev");
    expect(args).not.toContain("--disallowedTools");
  });

  test("jev arm hides every jev tool but jev_ask", () => {
    const args = buildArgs({
      prompt: "test",
      arm: ARMS.jev,
      mcpConfigPath: "/tmp/mcp.json",
      jsonSchema: mockSchema,
      model: "sonnet",
      effort: null,
      maxTurns: 40,
      maxBudgetUsd: 2,
    });

    expect(args).toContain("--allowedTools");
    expect(args).toContain("mcp__jev");
    const tools = args[args.indexOf("--disallowedTools") + 1];
    expect(tools).toBe("mcp__jev__jev_check mcp__jev__jev_classify mcp__jev__jev_score mcp__jev__jev_models");
  });

  test("jev-directed arm adds extra prompt", () => {
    const args = buildArgs({
      prompt: "test",
      arm: ARMS["jev-directed"],
      mcpConfigPath: "/tmp/mcp.json",
      jsonSchema: mockSchema,
      model: "sonnet",
      effort: null,
      maxTurns: 40,
      maxBudgetUsd: 2,
    });

    const idx = args.indexOf("--append-system-prompt");
    const prompt = args[idx + 1];
    expect(prompt).toContain("jev");
  });

  test("includes effort when provided", () => {
    const args = buildArgs({
      prompt: "test",
      arm: ARMS.baseline,
      mcpConfigPath: "/tmp/mcp.json",
      jsonSchema: mockSchema,
      model: "sonnet",
      effort: "high",
      maxTurns: 40,
      maxBudgetUsd: 2,
    });

    expect(args).toContain("--effort");
    expect(args).toContain("high");
  });
});

describe("buildEnv", () => {
  test("copies allowlisted variables", () => {
    const source = {
      HOME: "/home/test",
      PATH: "/usr/bin",
      CLASSPATH: "should-not-appear",
      PYTHONPATH: "should-not-appear",
    };

    const env = buildEnv(source, ARMS.baseline);

    expect(env.HOME).toBe("/home/test");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.CLASSPATH).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
  });

  test("adds TYPESAFE_API_KEY only for jev arms", () => {
    const source = {
      HOME: "/home/test",
      TYPESAFE_API_KEY: "test-key-12345678",
    };

    const envBaseline = buildEnv(source, ARMS.baseline);
    expect(envBaseline.TYPESAFE_API_KEY).toBeUndefined();

    const envJevAll = buildEnv(source, ARMS["jev-all"]);
    expect(envJevAll.TYPESAFE_API_KEY).toBe("test-key-12345678");
  });

  test("does not add TYPESAFE_API_KEY if not in source", () => {
    const source = { HOME: "/home/test" };

    const env = buildEnv(source, ARMS["jev-all"]);
    expect(env.TYPESAFE_API_KEY).toBeUndefined();
  });
});

describe("compareVersions", () => {
  test("considers equal versions as equal", () => {
    expect(compareVersions("2.1.284", "2.1.284")).toBe(0);
  });

  test("detects when a is greater", () => {
    expect(compareVersions("2.2.0", "2.1.284")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.1.284")).toBeGreaterThan(0);
  });

  test("detects when a is less", () => {
    expect(compareVersions("2.1.283", "2.1.284")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "2.1.284")).toBeLessThan(0);
  });

  test("handles different length version strings", () => {
    expect(compareVersions("2.1", "2.1.0")).toBe(0);
    expect(compareVersions("2.1.0", "2.1")).toBe(0);
  });
});

describe("preflight", () => {
  test("rejects when claude binary not found", async () => {
    const result = await preflight({
      exec: async () => ({ code: 127, stdout: "", stderr: "not found" }),
      exists: () => true,
      repoRoot: "/repo",
      env: { HOME: "/home" },
      jevArms: [],
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("command not found");
  });

  test("rejects when version is too old", async () => {
    const result = await preflight({
      exec: async (cmd) => {
        if (cmd[0] === "claude" && cmd[1] === "--version") {
          return { code: 0, stdout: "2.1.283 (Claude Code)\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
      exists: () => true,
      repoRoot: "/repo",
      env: { HOME: "/home" },
      jevArms: [],
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("2.1.284");
  });

  test("rejects when not logged in", async () => {
    const result = await preflight({
      exec: async (cmd) => {
        if (cmd[0] === "claude" && cmd[1] === "--version") {
          return { code: 0, stdout: "2.1.284 (Claude Code)\n", stderr: "" };
        }
        return { code: 0, stdout: '{"loggedIn": false}', stderr: "" };
      },
      exists: () => true,
      repoRoot: "/repo",
      env: { HOME: "/home" },
      jevArms: [],
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("Not logged in");
  });

  test("rejects when node_modules missing", async () => {
    const result = await preflight({
      exec: async (cmd) => {
        if (cmd[0] === "claude" && cmd[1] === "--version") {
          return { code: 0, stdout: "2.1.284 (Claude Code)\n", stderr: "" };
        }
        return { code: 0, stdout: '{"loggedIn": true}', stderr: "" };
      },
      exists: (path: string) => !path.includes("node_modules"),
      repoRoot: "/repo",
      env: { HOME: "/home" },
      jevArms: [],
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("node_modules");
  });

  test("rejects when jev arms selected without TYPESAFE_API_KEY", async () => {
    const result = await preflight({
      exec: async (cmd) => {
        if (cmd[0] === "claude" && cmd[1] === "--version") {
          return { code: 0, stdout: "2.1.284 (Claude Code)\n", stderr: "" };
        }
        return { code: 0, stdout: '{"loggedIn": true}', stderr: "" };
      },
      exists: () => true,
      repoRoot: "/repo",
      env: { HOME: "/home" },
      jevArms: ["jev-all"],
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("TYPESAFE_API_KEY");
  });

  test("succeeds with all checks passing", async () => {
    const result = await preflight({
      exec: async (cmd) => {
        if (cmd[0] === "claude" && cmd[1] === "--version") {
          return { code: 0, stdout: "2.1.284 (Claude Code)\n", stderr: "" };
        }
        return { code: 0, stdout: '{"loggedIn": true}', stderr: "" };
      },
      exists: () => true,
      repoRoot: "/repo",
      env: { HOME: "/home" },
      jevArms: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cliVersion).toBe("2.1.284");
    }
  });
});

describe("runClaude", () => {
  test("runs command and returns lines with timestamps", async () => {
    const result = await runClaude({
      args: [],
      cwd: "/tmp",
      env: {},
      timeoutMs: 5000,
      bin: ["printf", "line1\\nline2\\n"],
    });

    expect(result.lines.length).toBeGreaterThanOrEqual(1);
  });

  test("handles timeout", async () => {
    const result = await runClaude({
      args: [],
      cwd: "/tmp",
      env: {},
      timeoutMs: 100,
      bin: ["sleep", "2"],
    });

    expect(result.timedOut).toBe(true);
  });

  test("captures exit code", async () => {
    const result = await runClaude({
      args: [],
      cwd: "/tmp",
      env: {},
      timeoutMs: 5000,
      bin: ["true"],
    });

    expect(result.exitCode).toBe(0);
  });
});

describe("Claude Code project state cleanup", () => {
  test("maps a workspace to its ~/.claude/projects key and removes only eval dirs", () => {
    const home = mkdtempSync(join(tmpdir(), "eval-home-"));
    const ws = join(mkdtempSync(join(tmpdir(), "typesafe-mcp-eval-")), "workspace");
    mkdirSync(ws);
    const dir = claudeProjectDir(ws, home);
    expect(dir.startsWith(join(home, ".claude", "projects", "-"))).toBe(true);
    expect(dir).toContain("typesafe-mcp-eval");
    mkdirSync(join(dir, "session", "tool-results"), { recursive: true });
    expect(removeClaudeProjectDir(dir, home)).toBe(true);
    expect(existsSync(dir)).toBe(false);

    const other = join(home, ".claude", "projects", "-Users-someone-project");
    mkdirSync(other, { recursive: true });
    expect(removeClaudeProjectDir(other, home)).toBe(false);
    expect(removeClaudeProjectDir(join(home, "typesafe-mcp-eval-x"), home)).toBe(false);
    expect(existsSync(other)).toBe(true);
    rmSync(home, { recursive: true, force: true });
    rmSync(dirname(ws), { recursive: true, force: true });
  });
});
