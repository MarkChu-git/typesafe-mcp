#!/usr/bin/env bun
/**
 * Supply-chain scanners, run from the pinned binaries in tools.json.
 *
 * Usage: bun run scan [secrets] [deps]   (default: both)
 *   secrets  gitleaks over the whole git history; exceptions live in .gitleaks.toml
 *   deps     osv-scanner over bun.lock; exceptions live in osv-scanner.toml, each with a reason
 *
 * Neither passes on partial input: a shallow clone hides history from gitleaks, and osv-scanner
 * must read every package in bun.lock rather than pass after scanning none.
 */
import { join } from "node:path";
import { ensureTool } from "./tools.ts";

interface OsvPackage {
  package: { name: string; version: string };
  vulnerabilities?: { id: string; summary?: string }[];
}

interface OsvReport {
  results?: { packages?: OsvPackage[] }[];
}

const root = join(import.meta.dir, "..", "..");
const lockfile = join(root, "bun.lock");

async function secrets(): Promise<boolean> {
  const shallow = Bun.spawnSync(["git", "rev-parse", "--is-shallow-repository"], { cwd: root, stdout: "pipe" });
  if (shallow.stdout.toString().trim() !== "false") {
    console.error("secrets: shallow or missing git history; check out with fetch-depth: 0 so gitleaks sees every commit");
    return false;
  }
  const gitleaks = await ensureTool("gitleaks");
  const config = join(root, ".gitleaks.toml");
  const scan = Bun.spawnSync([gitleaks, "git", root, "--config", config, "--redact", "--no-banner", "--exit-code", "1"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(scan.exitCode === 0 ? "secrets: gitleaks found nothing in the git history" : "secrets: FAIL");
  return scan.exitCode === 0;
}

/** `name@version` for every package bun.lock resolves; the first tuple entry is that identifier. */
async function lockedPackages(): Promise<Set<string>> {
  const lock = Bun.JSONC.parse(await Bun.file(lockfile).text()) as { packages?: Record<string, [string, ...unknown[]]> };
  return new Set(Object.values(lock.packages ?? {}).map(([id]) => id));
}

async function deps(): Promise<boolean> {
  const osv = await ensureTool("osv-scanner");
  const scan = Bun.spawnSync([osv, "scan", "source", "--lockfile", lockfile, "--all-packages", "--format", "json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  // osv-scanner exits 1 when it finds vulnerabilities; anything else non-zero is a scanner error.
  if (scan.exitCode !== 0 && scan.exitCode !== 1) {
    console.error(`deps: osv-scanner exited ${scan.exitCode}\n${scan.stderr.toString().trim()}`);
    return false;
  }
  const report = JSON.parse(scan.stdout.toString()) as OsvReport;
  const packages = (report.results ?? []).flatMap((result) => result.packages ?? []);

  const scanned = new Set(packages.map(({ package: p }) => `${p.name}@${p.version}`));
  const unscanned = [...(await lockedPackages())].filter((id) => !scanned.has(id));
  if (scanned.size === 0 || unscanned.length > 0) {
    console.error(`deps: osv-scanner did not read all of bun.lock (unscanned: ${unscanned.slice(0, 10).join(", ")})`);
    return false;
  }

  const findings = packages.flatMap(({ package: p, vulnerabilities = [] }) =>
    vulnerabilities.map((v) => `  ${p.name}@${p.version}  ${v.id}  ${v.summary ?? ""}`.trimEnd()),
  );
  if (findings.length > 0) {
    console.error(`deps: ${findings.length} known vulnerabilities in bun.lock:\n${findings.join("\n")}`);
    console.error("Upgrade the package, or record a reasoned exception in osv-scanner.toml.");
    return false;
  }
  console.log(`deps: osv-scanner checked all ${scanned.size} packages in bun.lock, no known vulnerabilities`);
  return true;
}

const scanners = { secrets, deps } as const;
const selected = process.argv.slice(2);
const unknown = selected.filter((name) => !(name in scanners));
if (unknown.length > 0) {
  console.error(`usage: bun run scan [${Object.keys(scanners).join("] [")}]`);
  process.exit(1);
}
const names = (selected.length > 0 ? selected : Object.keys(scanners)) as (keyof typeof scanners)[];
const results = await Promise.all(names.map((name) => scanners[name]()));
if (results.includes(false)) process.exit(1);
