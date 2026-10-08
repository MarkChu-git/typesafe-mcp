import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvalConfig, ProbeResult, RunRecord, RunStatus, StreamLine } from "./types.ts";
import { redactAll } from "./redact.ts";

export function resultsDirName(model: string, now: Date): string {
  const iso = now.toISOString();
  const ts = iso.replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z");
  const sanitized = model.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  return `${ts}-${sanitized}`;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export async function readJson<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

export async function writeConfig(dir: string, config: EvalConfig): Promise<void> {
  await writeJson(join(dir, "config.json"), config);
}

export async function readConfig(dir: string): Promise<EvalConfig> {
  return readJson<EvalConfig>(join(dir, "config.json"));
}

export async function writeProbes(dir: string, probes: readonly ProbeResult[]): Promise<void> {
  await writeJson(join(dir, "probes.json"), probes);
}

export async function writeRun(
  dir: string,
  record: RunRecord,
  lines: readonly StreamLine[],
  secrets: readonly string[],
): Promise<void> {
  const runsDir = join(dir, "runs");
  await mkdir(runsDir, { recursive: true });

  const key = `${record.task}__${record.arm}__${record.rep}`;

  // Write JSONL with events
  const jsonlPath = join(runsDir, `${key}.jsonl`);
  const jsonlLines: string[] = [];
  for (const line of lines) {
    const redacted = redactAll(line.raw, secrets);
    let event: unknown = redacted;
    try {
      event = JSON.parse(redacted);
    } catch {
      // keep the redacted text as-is
    }
    jsonlLines.push(JSON.stringify({ receivedAt: line.receivedAt, event }));
  }
  await writeFile(jsonlPath, jsonlLines.join("\n"));

  // Write JSON record
  const jsonPath = join(runsDir, `${key}.json`);
  const recordStr = JSON.stringify(record, null, 2);
  const redacted = redactAll(recordStr, secrets);
  await writeFile(jsonPath, redacted + "\n");
}

async function readRunRecords(runsDir: string, entries: readonly string[]): Promise<RunRecord[]> {
  const files = entries.filter((e) => e.endsWith(".json"));
  const read = await Promise.all(
    files.map((f) => readJson<RunRecord>(join(runsDir, f)).catch(() => null)),
  );
  return read.filter((r): r is RunRecord => r !== null);
}

export async function readDone(dir: string): Promise<Map<string, RunStatus>> {
  const runsDir = join(dir, "runs");
  let entries: string[] = [];
  try {
    entries = await readdir(runsDir);
  } catch {
    return new Map();
  }

  const done = new Map<string, RunStatus>();
  for (const record of await readRunRecords(runsDir, entries)) {
    done.set(`${record.task}__${record.arm}__${record.rep}`, record.metrics.status);
  }
  return done;
}

export async function readRecords(dir: string): Promise<RunRecord[]> {
  const runsDir = join(dir, "runs");
  let entries: string[] = [];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const records = await readRunRecords(runsDir, entries);

  return records.toSorted((a, b) =>
    `${a.task}__${a.arm}__${a.rep}`.localeCompare(`${b.task}__${b.arm}__${b.rep}`),
  );
}

export async function gitInfo(repoRoot: string): Promise<{
  commit: string;
  dirtyFiles: string[];
}> {
  let commit = "";
  let dirtyFiles: string[] = [];

  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: repoRoot,
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    commit = stdout.trim();
  } catch {
    commit = "";
  }

  try {
    const proc = Bun.spawn(["git", "status", "--porcelain"], {
      cwd: repoRoot,
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    dirtyFiles = stdout
      .split("\n")
      .filter((line) => line.trim())
      .filter((line) => !line.includes("evals/results/"))
      .map((line) => line.slice(3));
  } catch {
    dirtyFiles = [];
  }

  return { commit, dirtyFiles };
}
