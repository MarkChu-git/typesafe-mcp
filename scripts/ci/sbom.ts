#!/usr/bin/env bun
/**
 * SPDX SBOM for the published package.
 *
 * Usage: bun run release:sbom <out.spdx.json>
 *
 * `bun build` inlines the runtime dependencies into dist/typesafe-mcp.js, so scanning the tarball
 * would list only the package itself, and bun.lock also holds the dev tree. Instead, install the
 * production tree from bun.lock into a scratch dir and let syft catalog the installed packages.
 * Fails unless every runtime dependency from package.json appears in the SBOM.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { ensureTool } from "./tools.ts";

interface SpdxDocument {
  packages?: { name: string; versionInfo?: string }[];
}

const outArg = process.argv[2];
if (!outArg) {
  console.error("usage: bun run release:sbom <out.spdx.json>");
  process.exit(1);
}
const out = resolve(outArg);
const root = join(import.meta.dir, "..", "..");
const syft = await ensureTool("syft");

const scratch = mkdtempSync(join(tmpdir(), "typesafe-mcp-sbom-"));
try {
  for (const file of ["package.json", "bun.lock"]) copyFileSync(join(root, file), join(scratch, file));
  const install = Bun.spawnSync(["bun", "install", "--production", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: scratch,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (install.exitCode !== 0) throw new Error(`bun install --production: ${install.stderr.toString().trim()}`);

  const scan = Bun.spawnSync(
    [
      syft,
      "scan",
      `dir:${scratch}`,
      // Installed package.json files only: the lockfile cataloger would also list dev-only transitive deps.
      "--override-default-catalogers",
      "javascript-package-cataloger",
      "--select-catalogers",
      "-file",
      "--source-name",
      pkg.name,
      "--source-version",
      pkg.version,
      "-o",
      `spdx-json=${out}`,
    ],
    { env: { ...process.env, SYFT_CHECK_FOR_APP_UPDATE: "false" }, stdout: "ignore", stderr: "pipe" },
  );
  if (scan.exitCode !== 0) throw new Error(`syft exited ${scan.exitCode}: ${scan.stderr.toString().trim()}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const sbom = (await Bun.file(out).json()) as SpdxDocument;
const listed = new Set((sbom.packages ?? []).map((p) => p.name));
const missing = Object.keys(pkg.dependencies).filter((name) => !listed.has(name));
if (missing.length > 0) {
  console.error(`sbom: runtime dependencies missing from ${out}: ${missing.join(", ")}`);
  process.exit(1);
}
const entries = (sbom.packages ?? []).map((p) => `${p.name}@${p.versionInfo ?? "?"}`).toSorted();
console.log(`sbom: ${entries.length} packages -> ${out}\n  ${entries.join("\n  ")}`);
