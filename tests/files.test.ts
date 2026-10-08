import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FilesError } from "../src/errors.ts";
import { filesRoots, MAX_FILE_BYTES, MAX_FILES, selectFiles } from "../src/files.ts";

const made: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A project with tickets, a hidden secret, an oversized file, a binary file and two escaping symlinks. */
function project(): string {
  const root = tempDir("files-root-");
  const outside = tempDir("files-outside-");
  writeFileSync(join(outside, "secret.txt"), "not yours");
  mkdirSync(join(root, "tickets"));
  writeFileSync(join(root, "tickets", "T002.md"), "Refund please");
  writeFileSync(join(root, "tickets", "T001.md"), "Payouts failing for 3 days");
  writeFileSync(join(root, "tickets", ".draft.md"), "hidden");
  writeFileSync(join(root, ".env"), "TOKEN=x");
  writeFileSync(join(root, "big.md"), "x".repeat(MAX_FILE_BYTES + 1));
  writeFileSync(join(root, "blob.md"), "a\u0000b");
  symlinkSync(join(outside, "secret.txt"), join(root, "link.md"));
  symlinkSync(outside, join(root, "linkdir"));
  return root;
}

describe("selectFiles", () => {
  test("reads matching files in path order and never hidden ones", async () => {
    const root = project();
    const { items, skipped } = await selectFiles(["tickets/*.md"], [root]);
    expect(items).toEqual([
      { path: "tickets/T001.md", content: "Payouts failing for 3 days" },
      { path: "tickets/T002.md", content: "Refund please" },
    ]);
    expect(skipped).toEqual({});
    await expect(selectFiles([".env"], [root])).rejects.toThrow("no files match .env");
  });

  test("skips oversized and binary files with a reason; wildcards ignore symlinks", async () => {
    const root = project();
    const { items, skipped } = await selectFiles(["*.md"], [root]);
    expect(items).toEqual([]);
    expect(skipped).toEqual({ "big.md": "65 KB is over the 64 KB limit", "blob.md": "binary file" });
    const all = await selectFiles(["**/*"], [root]);
    expect(all.items.map((i) => i.path)).toEqual(["tickets/T001.md", "tickets/T002.md"]);
  });

  test("a path through a symlink that leaves the root is never read", async () => {
    const root = project();
    expect(await selectFiles(["linkdir/*"], [root])).toEqual({
      items: [],
      skipped: { "linkdir/secret.txt": "outside the project directory" },
    });
    await expect(selectFiles(["../*"], [root])).rejects.toThrow('without ".."');
    await expect(selectFiles(["/etc/hosts"], [root])).rejects.toBeInstanceOf(FilesError);
  });

  test("a symlink inside the root that resolves to a hidden file or directory is never read", async () => {
    const root = tempDir("files-hidden-link-");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, ".env"), "TOKEN=abc");
    writeFileSync(join(root, ".git", "config"), "url = https://user:pass@example.com/repo.git");
    symlinkSync(join(root, ".env"), join(root, "docs", "notes.md"));
    symlinkSync(join(root, ".git"), join(root, "vis"));
    expect(await selectFiles(["docs/notes.md", "vis/*"], [root])).toEqual({
      items: [],
      skipped: { "docs/notes.md": "links to a hidden file", "vis/config": "links to a hidden file" },
    });
  });

  test("private keys are never read; node_modules only when the pattern names it", async () => {
    const root = tempDir("files-keys-");
    mkdirSync(join(root, "certs"));
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "certs", "server.pem"), "-----BEGIN PRIVATE KEY-----");
    writeFileSync(join(root, "id_ed25519"), "-----BEGIN OPENSSH PRIVATE KEY-----");
    writeFileSync(join(root, "node_modules", "pkg", "README.md"), "dependency");
    writeFileSync(join(root, "notes.md"), "ours");
    expect(await selectFiles(["certs/*", "id_ed25519"], [root])).toEqual({
      items: [],
      skipped: { "certs/server.pem": "private key or keystore", id_ed25519: "private key or keystore" },
    });
    expect((await selectFiles(["**/*.md"], [root])).items.map((i) => i.path)).toEqual(["notes.md"]);
    expect((await selectFiles(["node_modules/**/*.md"], [root])).items.map((i) => i.path)).toEqual([
      "node_modules/pkg/README.md",
    ]);
  });

  test("patterns may start with ./ or contain /./, as agents often write them", async () => {
    const root = project();
    for (const pattern of ["./tickets/*.md", "tickets/./T001.md"]) {
      // eslint-disable-next-line no-await-in-loop -- two cases, one after the other
      const { items } = await selectFiles([pattern], [root]);
      expect(items[0]?.path).toBe("tickets/T001.md");
    }
  });

  test("errors quote at most 200 characters of the patterns", async () => {
    const root = project();
    const long = `${"x".repeat(1000)}/*.md`;
    const error = await selectFiles([long], [root]).catch((e: unknown) => e);
    expect((error as Error).message.length).toBeLessThan(260);
  });

  test("refuses more than MAX_FILES files and needs an existing root", async () => {
    const root = tempDir("files-many-");
    for (let i = 0; i <= MAX_FILES; i += 1) writeFileSync(join(root, `f${i}.txt`), "x");
    await expect(selectFiles(["*.txt"], [root])).rejects.toThrow(`limit is ${MAX_FILES}`);
    for (const roots of [[], [join(tmpdir(), "typesafe-mcp-no-such-dir")]]) {
      // eslint-disable-next-line no-await-in-loop -- two cases, one after the other
      const error = await selectFiles(["*.txt"], roots).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FilesError);
      expect(error).toMatchObject({ category: "CONFIG" });
    }
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a file that cannot be read is skipped with the reason; the rest are still read",
    async () => {
      const root = tempDir("files-perm-");
      writeFileSync(join(root, "a.md"), "ok");
      writeFileSync(join(root, "b.md"), "locked");
      chmodSync(join(root, "b.md"), 0o000);
      expect(await selectFiles(["*.md"], [root])).toEqual({
        items: [{ path: "a.md", content: "ok" }],
        skipped: { "b.md": "could not be read (EACCES)" },
      });
    },
  );
});

describe("filesRoots", () => {
  test("TYPESAFE_FILES_ROOT wins without asking the client; otherwise the client's file:// roots", async () => {
    const projectDir = join(tmpdir(), "project");
    let asked = 0;
    const clientRoots = async () => {
      asked += 1;
      return [{ uri: pathToFileURL(projectDir).href }, { uri: "https://example.com/x" }];
    };
    expect(await filesRoots({ TYPESAFE_FILES_ROOT: "/configured" }, clientRoots)).toEqual(["/configured"]);
    expect(asked).toBe(0);
    expect(await filesRoots({}, clientRoots)).toEqual([projectDir]);
    expect(await filesRoots({}, async () => undefined)).toEqual([]);
  });
});
