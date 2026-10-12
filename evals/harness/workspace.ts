import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SDK_PACKAGE = "@typesafe-ai/sdk";

/**
 * Installs the repo's copy of the TypeSafe SDK into a workspace, with a package.json that depends on
 * it, the way a project using the SDK would have it. Files are copied, never linked, so nothing the
 * agent changes reaches the repo.
 */
export async function installSdk(workspaceDir: string, repoRoot: string): Promise<void> {
  const source = join(repoRoot, "node_modules", SDK_PACKAGE);
  const { version } = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as { version: string };
  await cp(source, join(workspaceDir, "node_modules", SDK_PACKAGE), { recursive: true, dereference: true });
  const manifest = { private: true, type: "module", dependencies: { [SDK_PACKAGE]: version } };
  await writeFile(join(workspaceDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function prepareWorkspace(
  srcDir: string,
  runId: string,
  root?: string,
): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const baseDir = root ?? tmpdir();
  const randSuffix = Math.random().toString(36).slice(2, 11);
  const runDirName = `${runId}-${randSuffix}`;
  const runDir = join(baseDir, "typesafe-mcp-eval", runDirName);
  const workspaceDir = join(runDir, "workspace");

  await mkdir(runDir, { recursive: true });
  await cp(srcDir, workspaceDir, { recursive: true });

  return {
    dir: workspaceDir,
    cleanup: async () => {
      const parentDir = join(baseDir, "typesafe-mcp-eval", runDirName);
      await rm(parentDir, { recursive: true, force: true });
    },
  };
}
