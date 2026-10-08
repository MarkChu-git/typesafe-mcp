import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRefServer, refDir } from "../../evals/harness/servers.ts";

/** Stands in for git and tar: `git archive` writes the tar, `tar -x` unpacks src/index.ts. */
function fakeExec() {
  const calls: string[][] = [];
  const exec = async (cmd: readonly string[]) => {
    calls.push([...cmd]);
    if (cmd[0] === "git") writeFileSync(cmd[cmd.indexOf("-o") + 1] ?? "", "tar");
    if (cmd[0] === "tar") {
      const dir = cmd[cmd.indexOf("-C") + 1] ?? "";
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "// released server");
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

const failingGit = async () => ({ code: 128, stdout: "", stderr: "fatal: not a valid object name v9" });

const roots: string[] = [];
const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "eval-servers-"));
  roots.push(root);
  return root;
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("prepareRefServer", () => {
  test("unpacks src/ of the tag once, next to the repo's node_modules", async () => {
    const root = tempRoot();
    const { exec, calls } = fakeExec();
    const o = { ref: "v0.1.1", repoRoot: "/repo", root, exec, env: {} };

    const entry = await prepareRefServer(o);
    expect(entry).toBe(join(refDir(root, "v0.1.1"), "src", "index.ts"));
    expect(existsSync(entry)).toBe(true);
    expect(readlinkSync(join(refDir(root, "v0.1.1"), "node_modules"))).toBe("/repo/node_modules");
    expect(calls.map((c) => c.slice(0, 4))).toEqual([
      ["git", "-C", "/repo", "archive"],
      ["tar", "-xf", join(refDir(root, "v0.1.1"), "src.tar"), "-C"],
    ]);
    expect(calls[0]?.slice(-2)).toEqual(["v0.1.1", "src"]);
    expect(existsSync(join(refDir(root, "v0.1.1"), "src.tar"))).toBe(false);

    expect(await prepareRefServer(o)).toBe(entry);
    expect(calls).toHaveLength(2);
  });

  test("a failing git archive names the ref", async () => {
    const root = tempRoot();
    await expect(prepareRefServer({ ref: "v9", repoRoot: "/repo", root, exec: failingGit, env: {} })).rejects.toThrow(
      "git archive v9 failed: fatal: not a valid object name v9",
    );
  });
});
