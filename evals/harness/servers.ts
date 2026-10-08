import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

type Exec = (
  cmd: readonly string[],
  env: Record<string, string>,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Where a released version's source is unpacked, e.g. `<root>/v0.1.1`. */
export const refDir = (root: string, ref: string): string => join(root, ref.replace(/[^\w.-]/g, "_"));

/**
 * Unpacks `src/` of a git ref (a release tag) next to a link to the repo's node_modules, so the
 * released server runs without a download. Returns its entry file; reuses an earlier unpack.
 */
export async function prepareRefServer(o: {
  ref: string;
  repoRoot: string;
  root: string;
  exec: Exec;
  env: Record<string, string>;
}): Promise<string> {
  const dir = refDir(o.root, o.ref);
  const entry = join(dir, "src", "index.ts");
  if (existsSync(entry)) return entry;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = join(dir, "src.tar");
  const archived = await o.exec(["git", "-C", o.repoRoot, "archive", "--format=tar", "-o", tar, o.ref, "src"], o.env);
  if (archived.code !== 0) throw new Error(`git archive ${o.ref} failed: ${archived.stderr.trim()}`);
  const extracted = await o.exec(["tar", "-xf", tar, "-C", dir], o.env);
  if (extracted.code !== 0) throw new Error(`unpacking ${o.ref} failed: ${extracted.stderr.trim()}`);
  rmSync(tar, { force: true });
  symlinkSync(join(o.repoRoot, "node_modules"), join(dir, "node_modules"));
  if (!existsSync(entry)) throw new Error(`${o.ref} has no src/index.ts`);
  return entry;
}
