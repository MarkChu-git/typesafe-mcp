#!/usr/bin/env bun
/**
 * Build the npm tarball once and prove it works before anything publishes it.
 *
 * Usage: bun run release:pack <out-dir>
 *
 * 1. `bun pm pack` into <out-dir> (prepack runs the single-file build).
 * 2. Check the file list: the bin target ships; sources, tests and dotfiles do not.
 * 3. Install the tarball into a scratch project, as `bunx typesafe-mcp` would, and run the
 *    stdio smoke test against the installed bin.
 * 4. Write <out-dir>/build-metadata.json: version, commit, toolchain, SHA-256 and npm integrity.
 *
 * The release workflow publishes exactly this file.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { smoke } from "./smoke.ts";

const REQUIRED = ["package/package.json", "package/README.md", "package/LICENSE", "package/dist/typesafe-mcp.js"];
const FORBIDDEN = /^package\/(src|tests|evals|scripts|node_modules)\/|^package\/\.|\/\.env/;
const root = join(import.meta.dir, "..", "..");

function run(cmd: string[], cwd = root): string {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited ${result.exitCode}\n${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

const outArg = process.argv[2];
if (!outArg) {
  console.error("usage: bun run release:pack <out-dir>");
  process.exit(1);
}
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

const tarballName = `${pkg.name}-${pkg.version}.tgz`;
const tarball = join(outDir, tarballName);
run(["bun", "pm", "pack", "--destination", outDir, "--quiet"]);

const files = run(["tar", "-tzf", tarball]).split("\n");
const missing = REQUIRED.filter((file) => !files.includes(file));
const leaked = files.filter((file) => FORBIDDEN.test(file));
if (missing.length > 0 || leaked.length > 0) {
  console.error(`pack: ${tarballName} has the wrong contents`);
  if (missing.length > 0) console.error(`  missing: ${missing.join(", ")}`);
  if (leaked.length > 0) console.error(`  must not ship: ${leaked.join(", ")}`);
  process.exit(1);
}
console.log(`pack: ${tarballName} (${files.length} files)`);

const scratch = mkdtempSync(join(tmpdir(), "typesafe-mcp-pack-"));
try {
  await Bun.write(join(scratch, "package.json"), `${JSON.stringify({ name: "pack-smoke", private: true })}\n`);
  run(["bun", "add", tarball], scratch);
  const installed = join(scratch, "node_modules", ".bin", "typesafe-mcp");
  // Windows gets .exe shims in .bin; run the installed entry file there instead.
  const [command, args] =
    process.platform === "win32"
      ? ["bun", [join(scratch, "node_modules", pkg.name, "dist", "typesafe-mcp.js")]]
      : [installed, []];
  await smoke(command, args);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const bytes = new Uint8Array(await Bun.file(tarball).arrayBuffer());
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
const metadata = {
  name: pkg.name,
  version: pkg.version,
  tarball: tarballName,
  sha256,
  integrity,
  commit: process.env.GITHUB_SHA ?? run(["git", "rev-parse", "HEAD"]),
  bun: Bun.version,
  builtAt: new Date().toISOString(),
};
await Bun.write(join(outDir, "build-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`pack: sha256 ${sha256}`);
