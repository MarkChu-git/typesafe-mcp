#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ARMS, DEFAULT_ARMS, expectedTools, isArmId, mcpConfig } from "./arms.ts";
import {
  buildArgs,
  buildEnv,
  claudeProjectDir,
  defaultExec,
  preflight,
  removeClaudeProjectDir,
  runClaude,
} from "./harness/claude.ts";
import { PROBE_PROMPT, PROBE_SCHEMA, toProbeResult } from "./harness/probe.ts";
import { buildMetricsJson, renderSummary } from "./harness/report.ts";
import {
  gitInfo,
  readConfig,
  readDone,
  readJson,
  readRecords,
  resultsDirName,
  writeConfig,
  writeJson,
  writeProbes,
  writeRun,
} from "./harness/results.ts";
import { buildMatrix, executeMatrix, pendingRuns, runId } from "./harness/schedule.ts";
import { redactAll } from "./harness/redact.ts";
import { prepareRefServer } from "./harness/servers.ts";
import { parseRun } from "./harness/stream.ts";
import {
  ARM_IDS,
  type Arm,
  type ArmId,
  type EvalConfig,
  type ProbeResult,
  type RunKey,
  type RunMetrics,
  type RunRecord,
} from "./harness/types.ts";
import { prepareWorkspace } from "./harness/workspace.ts";
import { ALL_TASKS } from "./tasks/index.ts";
import type { RegisteredTask } from "./tasks/types.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_RUN_ESTIMATE_USD = 0.5;

const DEFAULTS = {
  split: "dev",
  reps: 3,
  model: "sonnet",
  maxTurns: 40,
  maxRunUsd: 2,
  maxTotalUsd: 30,
  timeoutMin: 15,
  concurrency: 1,
  stopAtUtilization: 0.85,
} as const;

const USAGE = `Usage: bun run eval [options]

  --tasks <ids>               Comma-separated task ids (default: every task in --split)
  --split <dev|holdout|all>   Task split when --tasks is not given (default: dev)
  --arms <ids>                Comma-separated arms (default: ${DEFAULT_ARMS.join(",")}; all: ${ARM_IDS.join(",")})
  --reps <n>                  Runs per task × arm (default: 3)
  --model <model>             Claude Code model or alias (default: sonnet)
  --effort <level>            Pin the effort level (default: Claude Code's default)
  --max-turns <n>             Per run (default: 40)
  --max-run-usd <usd>         Per run, API list-price equivalent (default: 2)
  --max-total-usd <usd>       Whole eval, API list-price equivalent (default: 30)
  --timeout-min <min>         Per run wall clock (default: 15)
  --concurrency <n>           Parallel runs (default: 1; keep it low on a subscription)
  --stop-at-utilization <x>   Stop when a subscription window is this full (default: 0.85)
  --resume <dir>              Continue an earlier results directory
  --dry-run                   Print the run matrix and an estimate; start nothing
  --skip-probes               Do not measure tool-definition overhead
  --probes-only               Only measure tool-definition overhead (no tasks, no TYPESAFE_API_KEY needed)
  --keep-workspaces           Keep per-run workspace copies for debugging
  --allow-unreviewed          Allow tasks without REVIEW.md (report is marked unusable)
  --help`;

export interface MainDeps {
  runClaude: typeof runClaude;
  exec: typeof defaultExec;
  tasks: readonly RegisteredTask[];
  env: Readonly<Record<string, string | undefined>>;
  resultsRoot: string;
  /** Where released server versions are unpacked for `ref` arms. */
  serversRoot: string;
  now(): Date;
  log(line: string): void;
}

const defaultDeps: MainDeps = {
  runClaude,
  exec: defaultExec,
  tasks: ALL_TASKS,
  env: process.env,
  resultsRoot: join(REPO_ROOT, "evals", "results"),
  serversRoot: join(tmpdir(), "typesafe-mcp-eval-servers"),
  now: () => new Date(),
  log: (line) => console.log(line),
};

class UsageError extends Error {}

const csv = (v: string | undefined): string[] | null =>
  v === undefined ? null : v.split(",").map((s) => s.trim()).filter(Boolean);

function numberOpt(v: string | undefined, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name} must be a positive number, got "${v}"`);
  return n;
}

const usdText = (n: number): string => `$${n.toFixed(2)}`;
const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");

function selectTasks(all: readonly RegisteredTask[], ids: string[] | null, split: string): RegisteredTask[] {
  if (ids) {
    const unknown = ids.filter((id) => !all.some((t) => t.id === id));
    if (unknown.length > 0) {
      throw new UsageError(`unknown task id: ${unknown.join(", ")} (known: ${all.map((t) => t.id).join(", ")})`);
    }
    return ids.flatMap((id) => all.filter((t) => t.id === id));
  }
  if (!["dev", "holdout", "all"].includes(split)) throw new UsageError(`--split must be dev, holdout or all`);
  return all.filter((t) => split === "all" || t.split === split);
}

function selectArms(ids: string[] | null): ArmId[] {
  const chosen = ids ?? [...DEFAULT_ARMS];
  const unknown = chosen.filter((id) => !isArmId(id));
  if (unknown.length > 0) throw new UsageError(`unknown arm id: ${unknown.join(", ")} (known: ${ARM_IDS.join(", ")})`);
  return chosen.filter(isArmId);
}

/** Mean API-equivalent cost per run in the most recent results directory for the same model, if any. */
async function historicalRunCost(resultsRoot: string, model: string): Promise<number | null> {
  if (!existsSync(resultsRoot)) return null;
  const dirs = readdirSync(resultsRoot).toSorted().toReversed();
  for (const name of dirs) {
    const dir = join(resultsRoot, name);
    if (!existsSync(join(dir, "runs")) || !existsSync(join(dir, "config.json"))) continue;
    // eslint-disable-next-line no-await-in-loop -- stops at the first matching directory
    if ((await readConfig(dir)).model !== model) continue;
    // eslint-disable-next-line no-await-in-loop -- stops at the first directory with records
    const records = await readRecords(dir);
    if (records.length > 0) return records.reduce((s, r) => s + r.metrics.costUsd, 0) / records.length;
  }
  return null;
}

/** Entry files of unpacked released servers, keyed by git ref. */
type ServerEntries = ReadonlyMap<string, string>;

async function prepareServers(deps: MainDeps, arms: readonly ArmId[]): Promise<ServerEntries> {
  const entries = new Map<string, string>();
  const refs = new Set(arms.flatMap((a) => (ARMS[a].jev && ARMS[a].jev.ref ? [ARMS[a].jev.ref] : [])));
  for (const ref of refs) {
    // eslint-disable-next-line no-await-in-loop -- one git archive per released version
    const entry = await prepareRefServer({
      ref,
      repoRoot: REPO_ROOT,
      root: deps.serversRoot,
      exec: deps.exec,
      env: buildEnv(deps.env, ARMS.baseline),
    });
    entries.set(ref, entry);
  }
  return entries;
}

async function runInWorkspace(
  deps: MainDeps,
  o: {
    arm: Arm;
    cwd: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    config: EvalConfig;
    servers: ServerEntries;
  },
): Promise<{ metrics: RunMetrics; lines: Awaited<ReturnType<typeof runClaude>>["lines"] }> {
  const mcpPath = join(dirname(o.cwd), "mcp.json");
  const refEntry = o.arm.jev && o.arm.jev.ref ? o.servers.get(o.arm.jev.ref) : undefined;
  writeFileSync(mcpPath, JSON.stringify(mcpConfig(o.arm, REPO_ROOT, refEntry)));
  const args = buildArgs({
    prompt: o.prompt,
    arm: o.arm,
    mcpConfigPath: mcpPath,
    jsonSchema: o.jsonSchema,
    model: o.config.model,
    effort: o.config.effort,
    maxTurns: o.config.maxTurns,
    maxBudgetUsd: o.config.maxRunUsd,
  });
  const out = await deps.runClaude({
    args,
    cwd: o.cwd,
    env: buildEnv(deps.env, o.arm),
    timeoutMs: o.config.timeoutMin * 60_000,
  });
  const metrics = parseRun(out.lines, {
    expectedTools: expectedTools(o.arm),
    timedOut: out.timedOut,
    exitCode: out.exitCode,
  });
  // The CLI reports its own failures (bad flags, login) only on stderr.
  const stderr = out.stderr.trim();
  if (metrics.status === "answered" || !stderr) return { metrics, lines: out.lines };
  const tail = redactAll(stderr.slice(-500), [deps.env.TYPESAFE_API_KEY ?? "", deps.env.ANTHROPIC_API_KEY ?? ""]);
  const errorMessage = [metrics.errorMessage, `stderr: ${tail}`].filter(Boolean).join("; ");
  return { metrics: { ...metrics, errorMessage }, lines: out.lines };
}

function errorMetrics(message: string): RunMetrics {
  return {
    status: "error",
    model: null,
    cliVersion: null,
    tools: [],
    turns: 0,
    durationMs: 0,
    costUsd: 0,
    usageByModel: {},
    totalTokens: 0,
    toolCalls: [],
    toolErrors: 0,
    jevTokens: 0,
    firstTurnContextTokens: null,
    peakContextTokens: null,
    modelCalls: 0,
    structuredOutput: null,
    terminalReason: null,
    quota: null,
    errorMessage: message,
  };
}

async function runTask(
  deps: MainDeps,
  key: RunKey,
  task: RegisteredTask,
  config: EvalConfig,
  dir: string,
  keepWorkspaces: boolean,
  servers: ServerEntries,
): Promise<RunRecord> {
  const startedAt = deps.now().toISOString();
  const ws = await prepareWorkspace(task.workspaceDir, runId(key));
  const home = deps.env.HOME ?? homedir();
  const projectDir = claudeProjectDir(ws.dir, home);
  const secrets = [deps.env.TYPESAFE_API_KEY].filter((s): s is string => typeof s === "string" && s.length > 0);
  try {
    const { metrics: raw, lines } = await runInWorkspace(deps, {
      arm: ARMS[key.arm],
      cwd: ws.dir,
      prompt: task.prompt,
      jsonSchema: task.jsonSchema(),
      config,
      servers,
    });
    let metrics = raw;
    let score: number | null = null;
    let passed: boolean | null = null;
    let feedback: string | null = null;
    if (metrics.status === "answered") {
      const parsed = task.parse(metrics.structuredOutput);
      if (parsed.ok) {
        const s = task.score(parsed.answer, task.gold());
        score = s.score;
        passed = s.passed;
        feedback = parsed.feedback;
      } else {
        metrics = { ...metrics, status: "no_answer", errorMessage: parsed.error };
      }
    }
    const record: RunRecord = { ...key, metrics, score, passed, feedback, startedAt, finishedAt: deps.now().toISOString() };
    await writeRun(dir, record, lines, secrets);
    return record;
  } catch (e) {
    const record: RunRecord = {
      ...key,
      metrics: errorMetrics(e instanceof Error ? e.message : String(e)),
      score: null,
      passed: null,
      feedback: null,
      startedAt,
      finishedAt: deps.now().toISOString(),
    };
    await writeRun(dir, record, [], secrets);
    return record;
  } finally {
    if (!keepWorkspaces) {
      await ws.cleanup();
      removeClaudeProjectDir(projectDir, home);
    }
  }
}

async function runProbes(
  deps: MainDeps,
  config: EvalConfig,
  arms: readonly ArmId[],
  servers: ServerEntries,
): Promise<{ probes: ProbeResult[]; costUsd: number }> {
  const probes: ProbeResult[] = [];
  let costUsd = 0;
  for (const arm of arms) {
    const root = mkdtempSync(join(tmpdir(), "typesafe-mcp-probe-"));
    const cwd = join(root, "workspace");
    mkdirSync(cwd);
    const home = deps.env.HOME ?? homedir();
    const projectDir = claudeProjectDir(cwd, home);
    try {
      // eslint-disable-next-line no-await-in-loop -- probes run one at a time to keep quota use predictable
      const { metrics } = await runInWorkspace(deps, {
        arm: ARMS[arm],
        cwd,
        prompt: PROBE_PROMPT,
        jsonSchema: PROBE_SCHEMA,
        config,
        servers,
      });
      costUsd += metrics.costUsd;
      probes.push(toProbeResult(arm, metrics));
      deps.log(`probe ${arm}: ${metrics.status}, first-turn context ${metrics.firstTurnContextTokens ?? "?"} tokens`);
    } finally {
      rmSync(root, { recursive: true, force: true });
      removeClaudeProjectDir(projectDir, home);
    }
  }
  return { probes, costUsd };
}

function progressLine(done: number, total: number, r: RunRecord): string {
  const q = r.metrics.quota;
  const window = q?.fiveHourUtilization == null ? "" : `, 5h window ${Math.round(q.fiveHourUtilization * 100)}%`;
  const score = r.score === null ? "" : ` score=${r.score.toFixed(2)}`;
  return `[${done}/${total}] ${runId(r)} ${r.metrics.status}${score} tokens=${fmtInt(r.metrics.totalTokens)} cost=${usdText(r.metrics.costUsd)}${window}`;
}

export async function main(argv: readonly string[], deps: MainDeps = defaultDeps): Promise<number> {
  try {
    const { values } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: {
        tasks: { type: "string" },
        split: { type: "string" },
        arms: { type: "string" },
        reps: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        "max-turns": { type: "string" },
        "max-run-usd": { type: "string" },
        "max-total-usd": { type: "string" },
        "timeout-min": { type: "string" },
        concurrency: { type: "string" },
        "stop-at-utilization": { type: "string" },
        resume: { type: "string" },
        "dry-run": { type: "boolean" },
        "skip-probes": { type: "boolean" },
        "probes-only": { type: "boolean" },
        "keep-workspaces": { type: "boolean" },
        "allow-unreviewed": { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      deps.log(USAGE);
      return 0;
    }

    const resumeDir = values.resume === undefined ? null : resolve(values.resume);
    const probesOnly = values["probes-only"] === true;
    if (probesOnly && (resumeDir || values["skip-probes"])) {
      throw new UsageError("--probes-only cannot be combined with --resume or --skip-probes");
    }
    const previous = resumeDir
      ? await readConfig(resumeDir).catch(() => {
          throw new UsageError(`--resume: no eval run (config.json) in ${resumeDir}`);
        })
      : null;
    const tasks = probesOnly
      ? []
      : previous
        ? selectTasks(deps.tasks, previous.tasks, "all")
        : selectTasks(deps.tasks, csv(values.tasks), values.split ?? DEFAULTS.split);
    const arms = previous ? previous.arms : selectArms(csv(values.arms));
    if (tasks.length === 0 && !probesOnly) throw new UsageError("no tasks selected");

    const unreviewed = tasks.filter((t) => !t.reviewed).map((t) => t.id);
    if (unreviewed.length > 0 && !values["allow-unreviewed"] && !values["dry-run"]) {
      throw new UsageError(
        `not reviewed yet: ${unreviewed.join(", ")}. Check each gold.json and add REVIEW.md, ` +
          "or pass --allow-unreviewed for a trial run (its report is marked as not usable for conclusions).",
      );
    }

    const reps = probesOnly ? 0 : (previous?.reps ?? numberOpt(values.reps, "reps", DEFAULTS.reps));
    const matrix = buildMatrix(
      tasks.map((t) => t.id),
      arms,
      reps,
    );
    const pending = resumeDir ? pendingRuns(matrix, await readDone(resumeDir)) : matrix;
    const limits = {
      maxTurns: numberOpt(values["max-turns"], "max-turns", previous?.maxTurns ?? DEFAULTS.maxTurns),
      maxRunUsd: numberOpt(values["max-run-usd"], "max-run-usd", previous?.maxRunUsd ?? DEFAULTS.maxRunUsd),
      maxTotalUsd: numberOpt(values["max-total-usd"], "max-total-usd", previous?.maxTotalUsd ?? DEFAULTS.maxTotalUsd),
      timeoutMin: numberOpt(values["timeout-min"], "timeout-min", previous?.timeoutMin ?? DEFAULTS.timeoutMin),
      concurrency: numberOpt(values.concurrency, "concurrency", previous?.concurrency ?? DEFAULTS.concurrency),
      stopAtUtilization: numberOpt(
        values["stop-at-utilization"],
        "stop-at-utilization",
        previous?.stopAtUtilization ?? DEFAULTS.stopAtUtilization,
      ),
    };
    const probeArms = values["skip-probes"] || (resumeDir && existsSync(join(resumeDir, "probes.json"))) ? [] : arms;

    if (values["dry-run"]) {
      const perRun = await historicalRunCost(deps.resultsRoot, previous?.model ?? values.model ?? DEFAULTS.model);
      const runs = pending.length + probeArms.length;
      deps.log(`tasks: ${tasks.map((t) => `${t.id}${t.reviewed ? "" : " (not reviewed)"}`).join(", ")}`);
      deps.log(`arms: ${arms.join(", ")}; reps: ${reps}`);
      deps.log(`runs: ${pending.length} task runs + ${probeArms.length} probes${resumeDir ? ` (resuming ${resumeDir})` : ""}`);
      for (const k of pending) deps.log(`  ${runId(k)}`);
      deps.log(
        `estimate: about ${usdText(runs * (perRun ?? DEFAULT_RUN_ESTIMATE_USD))} API-equivalent ` +
          `(${perRun === null ? "default" : "measured"} ${usdText(perRun ?? DEFAULT_RUN_ESTIMATE_USD)} per run); ` +
          `cap ${usdText(limits.maxTotalUsd)}. Nothing was started.`,
      );
      return 0;
    }

    const check = await preflight({
      exec: deps.exec,
      exists: existsSync,
      repoRoot: REPO_ROOT,
      env: deps.env,
      // Listing tools needs no key, so probes alone run without one.
      jevArms: probesOnly ? [] : arms.filter((a) => ARMS[a].jev !== false),
    });
    if (!check.ok) {
      deps.log(check.message);
      return 1;
    }

    const servers = await prepareServers(deps, arms);
    const git = await gitInfo(REPO_ROOT);
    const model = previous?.model ?? values.model ?? DEFAULTS.model;
    const dir = resumeDir ?? join(deps.resultsRoot, resultsDirName(model, deps.now()));
    mkdirSync(join(dir, "runs"), { recursive: true });
    const config: EvalConfig = previous ?? {
      model,
      effort: values.effort ?? null,
      arms,
      tasks: tasks.map((t) => t.id),
      reps,
      ...limits,
      cliVersion: check.cliVersion,
      gitCommit: git.commit,
      gitDirtyFiles: git.dirtyFiles,
      createdAt: deps.now().toISOString(),
    };
    if (!previous) await writeConfig(dir, config);
    const runConfig: EvalConfig = { ...config, ...limits };
    deps.log(`results: ${dir}`);

    const probesPath = join(dir, "probes.json");
    let probes: ProbeResult[] = resumeDir && existsSync(probesPath) ? await readJson<ProbeResult[]>(probesPath) : [];
    let spentUsd = (await readRecords(dir)).reduce((s, r) => s + r.metrics.costUsd, 0);
    if (probeArms.length > 0) {
      const probe = await runProbes(deps, runConfig, probeArms, servers);
      probes = probe.probes;
      spentUsd += probe.costUsd;
      await writeProbes(dir, probes);
    }

    const byId = new Map(tasks.map((t) => [t.id, t]));
    let done = 0;
    const result = await executeMatrix(pending, {
      maxTotalUsd: runConfig.maxTotalUsd,
      stopAtUtilization: runConfig.stopAtUtilization,
      concurrency: runConfig.concurrency,
      spentUsd,
      runOne: async (key) => {
        const task = byId.get(key.task);
        if (!task) throw new Error(`task ${key.task} disappeared`);
        return runTask(deps, key, task, runConfig, dir, values["keep-workspaces"] === true, servers);
      },
      onRecord: (r) => {
        done += 1;
        deps.log(progressLine(done, pending.length, r));
      },
    });

    const records = await readRecords(dir);
    const summaryInput = {
      config,
      probes,
      records,
      notRun: result.notRun,
      stopped: result.stopped,
      unreviewedTasks: unreviewed,
    };
    writeFileSync(join(dir, "summary.md"), renderSummary(summaryInput));
    await writeJson(join(dir, "metrics.json"), buildMetricsJson(summaryInput));
    deps.log(`spent about ${usdText(result.spentUsd)} API-equivalent`);
    if (result.stopped) deps.log(`stopped early (${result.stopped}); continue later with --resume ${dir}`);
    deps.log(`report: ${join(dir, "summary.md")}`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError || (e instanceof TypeError && "code" in e)) {
      deps.log(`error: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    throw e;
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
