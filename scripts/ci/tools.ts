#!/usr/bin/env bun
/**
 * Pinned binaries for CI and local runs: the scanners (gitleaks, osv-scanner, syft) and Bend, which
 * checks the proofs in evals/laws/.
 *
 * Usage:
 *   bun run tools:install [name...]       download into .cache/ci-tools/
 *   bun run tools:update [name...]        pin each tool's latest upstream release
 *   bun scripts/ci/tools.ts path <name>   print the directory holding the binary, installing it first
 *
 * Every download is checked against the SHA-256 in tools.json before it is used.
 * `update` copies checksums from the GitHub release API — the digest GitHub recorded
 * when the maintainers uploaded the asset — never from a file it downloaded itself.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

interface Asset {
  /** Release asset name; `{version}` stands for the tool version. */
  name: string;
  sha256: string;
}

interface Tool {
  repo: string;
  version: string;
  /** Executable name, and its path inside `.tar.gz` assets. */
  binary: string;
  /** Other paths inside the `.tar.gz` asset that the binary reads, installed at the same relative place. */
  keep?: string[];
  /** Keyed by `${process.platform}-${process.arch}`. */
  assets: Record<string, Asset>;
}

type Manifest = Record<string, Tool>;

interface Release {
  tag_name: string;
  assets: { name: string; digest: string | null }[];
}

const root = join(import.meta.dir, "..", "..");
const manifestPath = join(import.meta.dir, "tools.json");
const cacheDir = join(root, ".cache", "ci-tools");
const platform = `${process.platform}-${process.arch}`;

const readManifest = async (): Promise<Manifest> => (await Bun.file(manifestPath).json()) as Manifest;

const resolveName = (asset: Asset, version: string): string => asset.name.replaceAll("{version}", version);

function lookup(manifest: Manifest, name: string): Tool {
  const tool = manifest[name];
  if (!tool) throw new Error(`unknown tool "${name}" (pinned: ${Object.keys(manifest).join(", ")})`);
  return tool;
}

/** Path to the verified binary for this platform, downloading it on first use. */
export async function ensureTool(name: string): Promise<string> {
  const tool = lookup(await readManifest(), name);
  const installDir = join(cacheDir, platform, `${name}-${tool.version}`);
  const binaryPath = join(installDir, tool.binary);
  if (existsSync(binaryPath)) return binaryPath;
  const asset = tool.assets[platform];
  if (!asset) {
    throw new Error(`${name} has no pinned asset for ${platform} (pinned: ${Object.keys(tool.assets).join(", ")})`);
  }
  await install(tool, asset, installDir);
  return binaryPath;
}

async function install(tool: Tool, asset: Asset, installDir: string): Promise<void> {
  const assetName = resolveName(asset, tool.version);
  const url = `https://github.com/${tool.repo}/releases/download/v${tool.version}/${assetName}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(`${assetName}: SHA-256 mismatch\n  pinned:     ${asset.sha256}\n  downloaded: ${actual}`);
  }

  // Unpack next to the destination and rename into place, so a failed run never leaves a
  // half-written binary that a later run would trust.
  mkdirSync(cacheDir, { recursive: true });
  const scratch = mkdtempSync(join(cacheDir, ".tmp-"));
  try {
    const staged = join(scratch, tool.binary);
    const keep = tool.keep ?? [];
    if (assetName.endsWith(".tar.gz")) {
      const archive = join(scratch, assetName);
      await Bun.write(archive, bytes);
      const tar = Bun.spawnSync(["tar", "-xzf", archive, "-C", scratch, tool.binary, ...keep], { stderr: "pipe" });
      if (tar.exitCode !== 0) throw new Error(`tar ${assetName}: ${tar.stderr.toString().trim()}`);
    } else if (keep.length > 0) {
      throw new Error(`${assetName}: keep needs a .tar.gz asset`);
    } else {
      await Bun.write(staged, bytes);
    }
    chmodSync(staged, 0o755);
    // The binary goes in last: ensureTool treats a present binary as a complete install.
    for (const path of keep) {
      const target = join(installDir, path);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(scratch, path), target);
    }
    const binaryPath = join(installDir, tool.binary);
    mkdirSync(dirname(binaryPath), { recursive: true });
    renameSync(staged, binaryPath);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  // stderr, so stdout carries only what a command prints for scripts, such as `path`.
  console.error(`installed ${tool.binary} ${tool.version} (${platform}, SHA-256 verified)`);
}

async function latest(name: string, tool: Tool): Promise<Tool> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${tool.repo}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`${tool.repo} latest release: HTTP ${res.status}`);
  const release = (await res.json()) as Release;
  const version = release.tag_name.replace(/^v/, "");

  const assets: Record<string, Asset> = {};
  for (const [key, asset] of Object.entries(tool.assets)) {
    const wanted = resolveName(asset, version);
    const found = release.assets.find((a) => a.name === wanted);
    if (!found) throw new Error(`${name} ${release.tag_name}: no release asset named ${wanted}`);
    if (!found.digest?.startsWith("sha256:")) {
      throw new Error(
        `${name} ${release.tag_name}: GitHub recorded no SHA-256 for ${wanted}; copy it from the project's published checksums`,
      );
    }
    assets[key] = { name: asset.name, sha256: found.digest.slice("sha256:".length) };
  }
  console.log(tool.version === version ? `${name} ${version} (current)` : `${name} ${tool.version} -> ${version}`);
  return { ...tool, version, assets };
}

async function update(names: string[]): Promise<void> {
  const manifest = await readManifest();
  const selected = names.length > 0 ? names : Object.keys(manifest);
  const updated = await Promise.all(selected.map((name) => latest(name, lookup(manifest, name))));
  selected.forEach((name, i) => {
    manifest[name] = updated[i] as Tool;
  });
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  const [command, ...names] = process.argv.slice(2);
  if (command === "install") {
    const selected = names.length > 0 ? names : Object.keys(await readManifest());
    await Promise.all(selected.map(ensureTool));
  } else if (command === "update") {
    await update(names);
  } else if (command === "path" && names.length === 1) {
    const [name = ""] = names;
    // CI appends this to $GITHUB_PATH to put a pinned binary, such as bend, on PATH.
    console.log(dirname(await ensureTool(name)));
  } else {
    console.error("usage: bun scripts/ci/tools.ts install|update [name...] | path <name>");
    process.exit(1);
  }
}
