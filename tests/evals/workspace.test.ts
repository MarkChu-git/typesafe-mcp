import { describe, expect, test } from "bun:test";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSdk, prepareWorkspace } from "../../evals/harness/workspace.ts";

describe("installSdk", () => {
  test("copies the SDK into the workspace with a package.json that depends on it", async () => {
    const root = await mkdtemp(join(tmpdir(), "install-sdk-"));
    const repo = join(root, "repo");
    const ws = join(root, "ws");
    const pkg = join(repo, "node_modules", "@typesafe-ai", "sdk");
    await mkdir(join(pkg, "dist"), { recursive: true });
    await mkdir(ws);
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@typesafe-ai/sdk", version: "9.9.9" }));
    await writeFile(join(pkg, "dist", "index.mjs"), "export {};");
    try {
      await installSdk(ws, repo);
      expect(await readFile(join(ws, "node_modules", "@typesafe-ai", "sdk", "dist", "index.mjs"), "utf8")).toBe(
        "export {};",
      );
      expect(JSON.parse(await readFile(join(ws, "package.json"), "utf8"))).toEqual({
        private: true,
        type: "module",
        dependencies: { "@typesafe-ai/sdk": "9.9.9" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps a task's own package.json, adding only the SDK to its dependencies, so SDK arms see the same repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "install-sdk-"));
    const repo = join(root, "repo");
    const ws = join(root, "ws");
    const pkg = join(repo, "node_modules", "@typesafe-ai", "sdk");
    await mkdir(pkg, { recursive: true });
    await mkdir(ws);
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@typesafe-ai/sdk", version: "9.9.9" }));
    const own = { name: "ecommerce-service", scripts: { start: "bun src/index.ts" }, dependencies: { zod: "^4.0.0" } };
    await writeFile(join(ws, "package.json"), JSON.stringify(own));
    try {
      await installSdk(ws, repo);
      expect(JSON.parse(await readFile(join(ws, "package.json"), "utf8"))).toEqual({
        ...own,
        dependencies: { zod: "^4.0.0", "@typesafe-ai/sdk": "9.9.9" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("prepareWorkspace", () => {
  test("copies source directory to workspace", async () => {
    const tmpDir = tmpdir();
    const srcDir = join(tmpDir, `src-${Math.random().toString(36).slice(2)}`);
    await mkdir(srcDir, { recursive: true });

    // Create test files
    await writeFile(join(srcDir, "file1.txt"), "content1");
    await mkdir(join(srcDir, "subdir"), { recursive: true });
    await writeFile(join(srcDir, "subdir", "file2.txt"), "content2");

    try {
      const { dir, cleanup } = await prepareWorkspace(srcDir, "test-run");

      // Verify files are copied
      const content1 = await readFile(join(dir, "file1.txt"), "utf-8");
      expect(content1).toBe("content1");

      const content2 = await readFile(join(dir, "subdir", "file2.txt"), "utf-8");
      expect(content2).toBe("content2");

      // Cleanup
      await cleanup();

      // Verify cleanup removed the directory
      try {
        await readFile(join(dir, "file1.txt"), "utf-8");
        throw new Error("Should have been deleted");
      } catch (e) {
        if ((e as any).code !== "ENOENT") throw e;
      }
    } finally {
      // Clean up source
      try {
        await Bun.spawn(["rm", "-rf", srcDir]).exited;
      } catch {
        // ignore
      }
    }
  });

  test("runs are independent", async () => {
    const tmpDir = tmpdir();
    const srcDir = join(tmpDir, `src-${Math.random().toString(36).slice(2)}`);
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "file.txt"), "original");

    try {
      const { dir: dir1, cleanup: cleanup1 } = await prepareWorkspace(srcDir, "run1");
      const { dir: dir2, cleanup: cleanup2 } = await prepareWorkspace(srcDir, "run2");

      // Modify first run
      await writeFile(join(dir1, "file.txt"), "modified");

      // Verify second run is unchanged
      const content2 = await readFile(join(dir2, "file.txt"), "utf-8");
      expect(content2).toBe("original");

      await cleanup1();
      await cleanup2();
    } finally {
      try {
        await Bun.spawn(["rm", "-rf", srcDir]).exited;
      } catch {
        // ignore
      }
    }
  });
});
