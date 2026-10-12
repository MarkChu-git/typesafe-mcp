import type { McpServer } from "@modelcontextprotocol/server";
import type { EntryType, Questions, TypeSafeClient, Usage } from "@typesafe-ai/sdk";
import { getClient, type ClientDeps } from "../client.ts";
import { classify, FilesError, redact, toToolError } from "../errors.ts";
import { capErrors, selector, typesOf, type Answered } from "../filters.ts";
import { filesRoots, MAX_FILE_BYTES, MAX_SPLIT_FILE_BYTES, selectFiles, shown } from "../files.ts";
import { ANSWER_NOTE, thresholdsFrom, toAnswer, type Thresholds } from "../gating.ts";
import { buildQuestions, toState } from "../questions.ts";
import { isPiece, MAX_RECORDS, splitFile, type Part } from "../records.ts";
import { ok } from "../result.ts";
import { askInput, askOutput, parseTop, parseWhere, type AskInput } from "../schemas.ts";

/**
 * Server instructions: hosts show them even while tool definitions are deferred, so they carry when to
 * use jev_ask, which the tool description alone cannot do for an agent that never loads it.
 */
export const ASK_INSTRUCTIONS =
  "Jev answers typed questions (yes/no, pick one, rate on levels) with a certainty and an act/review/abstain gate. Use jev_ask to apply one judgment to many files or records you don't need to read yourself: triage, filtering a corpus to what matters, ranking, policy checks. Pass globs, not content, and use where, top or counts to get back only what you need. Exact matches are cheaper with grep.";

export const ASK_DESCRIPTION = `Ask Jev, TypeSafe's decision model, typed questions about one state, or about every file or record that files matches, without reading them into your context. Ask every question about the same input in one call. Jev does not see question ids, so write each question to stand alone: plain English, literal, one judgment per question. With files, Jev sees {file, content, context}; refer to them by name, e.g. \`content\`. A score answer is the expected level index. ${ANSWER_NOTE}`;

/** Jev requests in flight at once for a `files` call. */
const REQUEST_CONCURRENCY = 8;
/** How long to wait for the client's roots before treating it as sharing none. */
const ROOTS_TIMEOUT_MS = 5_000;

/** The client's roots if it declares the capability; a client that fails to answer shares none. */
async function listClientRoots(server: McpServer): Promise<readonly { uri: string }[] | undefined> {
  if (!server.server.getClientCapabilities()?.roots) return undefined;
  try {
    return (await server.server.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS })).roots;
  } catch {
    return undefined;
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop -- each worker handles one request at a time
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
});

type Outcome =
  | (Answered & { model: string; usage: Usage })
  | { key: string; error: unknown }
  | { key: string; reason: string };

/**
 * One Jev request per record, the same questions each time; a failed request becomes an `error` for its
 * record, and a record that could not be made keeps its `reason`. Stops sending once the call is
 * cancelled or the key is rejected, since every later request would fail too.
 */
async function askRecords(
  client: TypeSafeClient,
  parts: readonly Part[],
  questions: Questions,
  input: AskInput,
  thresholds: Thresholds,
  signal: AbortSignal,
): Promise<Outcome[]> {
  let rejectedKey: unknown;
  return mapLimit(parts, REQUEST_CONCURRENCY, async (part): Promise<Outcome> => {
    if (!isPiece(part)) return part;
    if (signal.aborted) return { key: part.key, error: signal.reason };
    if (rejectedKey !== undefined) return { key: part.key, error: rejectedKey };
    const state: EntryType = {
      file: part.file,
      content: part.content,
      ...(input.context === undefined ? {} : { context: input.context as EntryType }),
    };
    try {
      const res = await client.systemOne(
        { state, questions, ...(input.model ? { model: input.model } : {}) },
        { signal },
      );
      const answers = Object.fromEntries(
        Object.entries(res.answers).map(([id, a]) => [id, toAnswer(a, thresholds, input.detailed)]),
      );
      return { key: part.key, model: res.model, usage: res.usage, answers, raw: res.answers };
    } catch (error) {
      if (classify(error).category === "AUTH") rejectedKey ??= error;
      return { key: part.key, error };
    }
  });
}

const failureText = (error: unknown): string => {
  const c = classify(error);
  return redact(`${c.category}: ${c.hint}${c.detail ? ` ${c.detail}` : ""}`);
};

/** The record key and reason of an outcome without answers. */
function problemOf(outcome: Outcome): [string, string][] {
  if ("reason" in outcome) return [[outcome.key, outcome.reason]];
  if ("error" in outcome) return [[outcome.key, failureText(outcome.error)]];
  return [];
}

export function registerAsk(server: McpServer, deps: ClientDeps = {}): void {
  server.registerTool(
    "jev_ask",
    {
      title: "Ask Jev",
      description: ASK_DESCRIPTION,
      inputSchema: askInput,
      outputSchema: askOutput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input, ctx) => {
      try {
        const client = getClient(deps);
        const thresholds = thresholdsFrom(input);
        const questions = buildQuestions(input.questions);
        const { signal } = ctx.mcpReq;
        if (input.files === undefined) {
          const res = await client.systemOne(
            { state: toState(input.state), questions, ...(input.model ? { model: input.model } : {}) },
            { signal },
          );
          const answers = Object.fromEntries(
            Object.entries(res.answers).map(([id, a]) => [id, toAnswer(a, thresholds, input.detailed)]),
          );
          return ok(askOutput.parse({ answers }), { model: res.model, usage: res.usage, thresholds });
        }

        const mode = input.items ?? "file";
        // Before any file is read or request sent, so a mistake in where or top costs nothing.
        const where = input.where === undefined ? undefined : parseWhere(input.where);
        const top = input.top === undefined ? undefined : parseTop(input.top);
        const select = selector({ where, top, counts: input.counts }, typesOf(input.questions));
        const patterns = typeof input.files === "string" ? [input.files] : input.files;
        const roots = await filesRoots(deps.env ?? process.env, () => listClientRoots(server), deps.cwd ?? process.cwd());
        const maxBytes = mode === "file" ? MAX_FILE_BYTES : MAX_SPLIT_FILE_BYTES;
        const { items, skipped } = await selectFiles(patterns, roots, maxBytes);
        const parts = items.flatMap((item) => splitFile(item, mode));
        const records = parts.filter(isPiece).length;
        if (records > MAX_RECORDS) {
          throw new FilesError(`${shown(patterns)} give ${records} records; the limit is ${MAX_RECORDS} per call, so narrow the pattern`);
        }
        const outcomes = await askRecords(client, parts, questions, input, thresholds, signal);
        const answered = outcomes.filter((o) => "answers" in o);
        const firstFailure = outcomes.find((o) => "error" in o);
        // Nothing answered: surface the first failure (e.g. AUTH) as the tool error it is.
        if (answered.length === 0 && firstFailure) throw firstFailure.error;

        const problems = [...Object.entries(skipped), ...outcomes.flatMap(problemOf)];
        const usage = answered.reduce((u, r) => addUsage(u, r.usage), { input_tokens: 0, output_tokens: 0 });
        return ok(askOutput.parse({ ...select(answered), ...capErrors(problems) }), {
          model: answered[0]?.model ?? "",
          usage,
          thresholds,
        });
      } catch (e) {
        return toToolError(e, { tool: "jev_ask" });
      }
    },
  );
}
