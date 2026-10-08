import { realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ARMS, disallowedTools } from "../arms.ts";
import type { Arm, StreamLine } from "./types.ts";

export const MIN_CLI_VERSION = "2.1.284";
export const ENV_ALLOWLIST = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"] as const;
export const EVAL_INSTRUCTIONS =
  "You are completing a task inside the current directory. Work only with the files in this directory. When you are done, return your final answer as structured output. Use the optional feedback field for one or two sentences about which tools helped and which confused you.";

export function buildEnv(
  source: Readonly<Record<string, string | undefined>>,
  arm: Arm,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  if (arm.jev && source.TYPESAFE_API_KEY !== undefined) {
    env.TYPESAFE_API_KEY = source.TYPESAFE_API_KEY;
  }
  return env;
}

export function buildArgs(o: {
  prompt: string;
  arm: Arm;
  mcpConfigPath: string;
  jsonSchema: Record<string, unknown>;
  model: string;
  effort: string | null;
  maxTurns: number;
  maxBudgetUsd: number;
}): string[] {
  const args: string[] = ["-p", o.prompt];
  args.push("--model", o.model);
  args.push("--restricted");
  args.push("--strict-mcp-config");
  args.push("--mcp-config", o.mcpConfigPath);
  args.push("--tools", "Read,Grep,Glob");

  if (o.arm.jev) {
    args.push("--allowedTools", "mcp__jev");
  }

  const disallowed = disallowedTools(o.arm);
  if (disallowed.length > 0) {
    args.push("--disallowedTools", disallowed.join(" "));
  }

  args.push("--disable-slash-commands");
  args.push("--no-session-persistence");
  args.push("--permission-mode", "dontAsk");
  args.push("--output-format", "stream-json");
  args.push("--verbose");
  args.push("--json-schema", JSON.stringify(o.jsonSchema));
  args.push("--max-turns", String(o.maxTurns));
  args.push("--max-budget-usd", String(o.maxBudgetUsd));

  const systemPrompt = o.arm.extraPrompt
    ? `${EVAL_INSTRUCTIONS} ${o.arm.extraPrompt}`
    : EVAL_INSTRUCTIONS;
  args.push("--append-system-prompt", systemPrompt);

  if (o.effort !== null) {
    args.push("--effort", o.effort);
  }

  args.push("--exclude-dynamic-system-prompt-sections");

  return args;
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

export interface PrefixDeps {
  exec(cmd: readonly string[], env: Record<string, string>): Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
  exists(path: string): boolean;
  repoRoot: string;
  env: Readonly<Record<string, string | undefined>>;
  jevArms: readonly string[];
}

export async function preflight(deps: PrefixDeps): Promise<
  { ok: true; cliVersion: string } | { ok: false; message: string }
> {
  const cleanEnv = buildEnv(deps.env, ARMS.baseline);
  const versionResult = await deps.exec(["claude", "--version"], cleanEnv);
  if (versionResult.code !== 0) {
    return { ok: false, message: "claude: command not found. Install Claude Code." };
  }

  const match = versionResult.stdout.match(/^(\d+\.\d+\.\d+)/);
  if (!match || !match[1]) {
    return { ok: false, message: `claude: invalid version output "${versionResult.stdout.trim()}"` };
  }
  const cliVersion = match[1];
  if (compareVersions(cliVersion, MIN_CLI_VERSION) < 0) {
    return {
      ok: false,
      message: `claude: version ${cliVersion} < ${MIN_CLI_VERSION}. Run "claude update".`,
    };
  }

  const authResult = await deps.exec(["claude", "auth", "status"], cleanEnv);
  if (authResult.code !== 0) {
    return { ok: false, message: "Not logged in to Claude Code. Run: claude auth login" };
  }

  let loggedIn = false;
  try {
    const json = JSON.parse(authResult.stdout);
    loggedIn = (json as Record<string, unknown>).loggedIn === true;
  } catch {
    // ignore parse errors
  }
  if (!loggedIn) {
    return { ok: false, message: "Not logged in to Claude Code. Run: claude auth login" };
  }

  if (!deps.exists(`${deps.repoRoot}/node_modules`)) {
    return { ok: false, message: "node_modules not found. Run: bun install" };
  }

  const apiKey = deps.env.TYPESAFE_API_KEY;
  if (deps.jevArms.length > 0 && !apiKey) {
    const jevList = deps.jevArms.join(", ");
    return {
      ok: false,
      message: `Set TYPESAFE_API_KEY to use: ${jevList}. Only baseline works without it.`,
    };
  }

  return { ok: true, cliVersion };
}

export async function runClaude(o: {
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  bin?: readonly string[];
  onLine?(line: StreamLine): void;
}): Promise<{
  lines: StreamLine[];
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
}> {
  const cmd: string[] = [...(o.bin ?? ["claude"]), ...o.args];
  const proc = Bun.spawn(cmd, {
    cwd: o.cwd,
    env: o.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const lines: StreamLine[] = [];
  let stderr = "";
  let timedOut = false;

  const stderrText = new Response(proc.stderr).text();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }, 5000).unref();
  }, o.timeoutMs);

  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- reading a stream chunk by chunk
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) {
          const line: StreamLine = { receivedAt: Date.now(), raw: part };
          lines.push(line);
          o.onLine?.(line);
        }
      }
    }
    if (buffer.trim()) {
      const line: StreamLine = { receivedAt: Date.now(), raw: buffer };
      lines.push(line);
      o.onLine?.(line);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  stderr = (await stderrText).slice(-4096);

  const exitCode = await proc.exited;
  return { lines, exitCode, timedOut, stderr };
}

export async function defaultExec(
  cmd: readonly string[],
  env: Record<string, string>,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([...cmd], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;

  return { code: code ?? 1, stdout, stderr };
}

/** Claude Code keeps per-directory state (large tool outputs, etc.) under ~/.claude/projects/<cwd, non-alphanumerics as "-">. */
export function claudeProjectDir(cwd: string, home: string): string {
  return join(home, ".claude", "projects", realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-"));
}

/** Deletes the state Claude Code left for one of our temp workspaces; refuses anything else. */
export function removeClaudeProjectDir(dir: string, home: string): boolean {
  const root = join(home, ".claude", "projects");
  if (dirname(dir) !== root || !/typesafe-mcp-(eval|probe)/.test(basename(dir))) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
