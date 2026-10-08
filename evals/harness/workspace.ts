import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
