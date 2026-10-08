import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV } from "./config.ts";
import { FilesError } from "./errors.ts";

/** Files one `jev_ask` call may read; each one is a separate Jev request. */
export const MAX_FILES = 100;
/** Jev takes about 32k tokens of state; larger files are skipped. */
export const MAX_FILE_BYTES = 64 * 1024;

export interface FileItem {
  /** Relative to the first root, with `/` separators. */
  path: string;
  content: string;
}

export interface FileSelection {
  items: FileItem[];
  /** Matched files that were skipped, with the reason. */
  skipped: Record<string, string>;
}

/** The local path of a `file://` URI; other schemes and remote hosts give undefined. */
function localPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/**
 * Directories `files` may read: `TYPESAFE_FILES_ROOT` when set, else the `file://` roots the client
 * declares (Claude Code declares its working directory). The client is only asked when needed.
 */
export async function filesRoots(
  env: Record<string, string | undefined>,
  clientRoots: () => Promise<readonly { uri: string }[] | undefined>,
): Promise<string[]> {
  const configured = env[ENV.filesRoot]?.trim();
  if (configured) return [configured];
  const paths: string[] = [];
  for (const root of (await clientRoots()) ?? []) {
    const path = localPath(root.uri);
    if (path !== undefined) paths.push(path);
  }
  return paths;
}

const within = (dir: string, path: string): boolean => path === dir || path.startsWith(dir + sep);
/** `.env`, `.git/…` and the like are never read. */
const isHidden = (rel: string): boolean => rel.split("/").some((part) => part.startsWith("."));
/** Private keys and keystores are never read, even when their names are not hidden. */
const isKeyFile = (rel: string): boolean => /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(?:pem|key|p12|pfx|jks|keystore))$/i.test(rel);
/** Dependencies are skipped unless the pattern names them, so `**\/*.ts` means the project's own files. */
const inDependencies = (rel: string, pattern: string): boolean =>
  !pattern.includes("node_modules") && rel.split("/").includes("node_modules");

/** Patterns as error messages show them: an agent's own long input is not echoed back in full. */
function shown(patterns: readonly string[]): string {
  const text = patterns.join(", ");
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** `./tickets/*.md` and `tickets/./a.md` mean what they say, though Bun.Glob matches neither as written. */
function normalizePattern(pattern: string): string {
  const normalized = pattern.replace(/^(?:\.\/)+/, "").replace(/\/(?:\.\/)+/g, "/");
  if (isAbsolute(normalized) || normalized.split(/[\\/]/).includes("..")) {
    throw new FilesError(`files pattern "${shown([pattern])}" must be relative to the project root, without ".."`);
  }
  return normalized;
}

const overLimit = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB is over the ${MAX_FILE_BYTES / 1024} KB limit`;

/**
 * Expands `patterns` under the first root and reads each match. Hidden paths and key files are never
 * read, symlinked directories are not followed by wildcards, and every file must resolve inside one of
 * `roots`, so the agent can only point at project files.
 */
export async function selectFiles(patterns: readonly string[], roots: readonly string[]): Promise<FileSelection> {
  const [first] = roots;
  if (first === undefined) {
    throw new FilesError(
      `files needs a project directory: this host did not share MCP roots, so set ${ENV.filesRoot} in the server env`,
      "CONFIG",
    );
  }
  const normalized = patterns.map(normalizePattern);
  const resolved = await Promise.all(roots.map((r) => realpath(r).catch(() => undefined)));
  const [base] = resolved;
  if (base === undefined) {
    throw new FilesError(`project directory ${first} does not exist; check ${ENV.filesRoot} or the host's MCP roots`, "CONFIG");
  }
  const realRoots = resolved.filter((r) => r !== undefined);

  const matched = new Set<string>();
  for (const pattern of normalized) {
    const glob = new Bun.Glob(pattern);
    for (const path of glob.scanSync({ cwd: base, onlyFiles: true, followSymlinks: false, dot: false })) {
      const rel = path.split(sep).join("/");
      if (isHidden(rel) || inDependencies(rel, pattern)) continue;
      matched.add(rel);
      // Stop at the limit rather than walk the rest of a large tree.
      if (matched.size > MAX_FILES) {
        throw new FilesError(`${shown(patterns)} matches more than ${MAX_FILES} files; the limit is ${MAX_FILES}, so narrow the pattern`);
      }
    }
  }
  if (matched.size === 0) throw new FilesError(`no files match ${shown(patterns)}`);

  const items: FileItem[] = [];
  const skipped: Record<string, string> = {};
  for (const path of [...matched].toSorted()) {
    // eslint-disable-next-line no-await-in-loop -- at most MAX_FILES small local reads, kept in order
    const read = await readMatch(join(base, path), realRoots);
    if (typeof read === "string") items.push({ path, content: read });
    else skipped[path] = read.skipped;
  }
  return { items, skipped };
}

/** One matched file's text, or why it is skipped. A file that cannot be read never fails the whole call. */
async function readMatch(absolute: string, realRoots: readonly string[]): Promise<string | { skipped: string }> {
  let handle: FileHandle | undefined;
  try {
    // Open first, then check where the opened file lives, so a symlink swapped in after the check cannot
    // redirect the read. O_NONBLOCK keeps a FIFO from blocking the open.
    handle = await open(absolute, constants.O_RDONLY | constants.O_NONBLOCK);
    const real = await realpath(absolute);
    const root = realRoots.find((r) => within(r, real));
    if (root === undefined) return { skipped: "outside the project directory" };
    const rel = relative(root, real).split(sep).join("/");
    if (isHidden(rel)) return { skipped: "links to a hidden file" };
    if (isKeyFile(rel)) return { skipped: "private key or keystore" };
    // lstat, not stat: a symlink placed at `real` after realpath must not match the opened file.
    const [opened, current] = await Promise.all([handle.stat({ bigint: true }), lstat(real, { bigint: true })]);
    if (opened.dev !== current.dev || opened.ino !== current.ino) return { skipped: "changed while being read" };
    if (!opened.isFile()) return { skipped: "not a regular file" };
    if (opened.size > MAX_FILE_BYTES) return { skipped: overLimit(Number(opened.size)) };
    const bytes = await readAtMost(handle, MAX_FILE_BYTES + 1);
    if (bytes.length > MAX_FILE_BYTES) return { skipped: overLimit(bytes.length) };
    if (bytes.includes(0)) return { skipped: "binary file" };
    return new TextDecoder().decode(bytes);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { skipped: typeof code === "string" ? `could not be read (${code})` : "could not be read" };
  } finally {
    await handle?.close();
  }
}

/** Reads up to `limit` bytes from the start of the file, however it changes meanwhile. */
async function readAtMost(handle: FileHandle, limit: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit);
  let length = 0;
  while (length < limit) {
    // eslint-disable-next-line no-await-in-loop -- sequential reads of one file
    const { bytesRead } = await handle.read(buffer, length, limit - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}
