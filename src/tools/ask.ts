import type { McpServer } from "@modelcontextprotocol/server";
import type { EntryType, Questions, TypeSafeClient, Usage } from "@typesafe-ai/sdk";
import { getClient, type ClientDeps } from "../client.ts";
import { classify, redact, toToolError } from "../errors.ts";
import { filesRoots, selectFiles, type FileItem } from "../files.ts";
import { ANSWER_NOTE, thresholdsFrom, toAnswer, type Thresholds } from "../gating.ts";
import { buildQuestions, toState } from "../questions.ts";
import { ok } from "../result.ts";
import { askInput, askOutput, type AskInput, type JevAnswer } from "../schemas.ts";

export const ASK_DESCRIPTION = `Ask Jev, TypeSafe's decision model, typed questions about one state. Put every question about the same state in one call; to ask them of many files, pass files instead of state. Write questions in plain English, literally and specifically. A score answer is the expected level index. ${ANSWER_NOTE}`;

/** Jev requests in flight at once for a `files` call. */
const FILE_CONCURRENCY = 4;
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

type FileResult =
  | { path: string; model: string; usage: Usage; answers: Record<string, JevAnswer> }
  | { path: string; error: unknown };

/**
 * One Jev request per file, the same questions each time; per-file failures become `errors`. Stops
 * sending once the call is cancelled or the key is rejected, since every later request would fail too.
 */
async function askFiles(
  client: TypeSafeClient,
  items: readonly FileItem[],
  questions: Questions,
  input: AskInput,
  thresholds: Thresholds,
  signal: AbortSignal,
): Promise<FileResult[]> {
  let rejectedKey: unknown;
  return mapLimit(items, FILE_CONCURRENCY, async (item) => {
    if (signal.aborted) return { path: item.path, error: signal.reason };
    if (rejectedKey !== undefined) return { path: item.path, error: rejectedKey };
    const state: EntryType = {
      file: item.path,
      content: item.content,
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
      return { path: item.path, model: res.model, usage: res.usage, answers };
    } catch (error) {
      if (classify(error).category === "AUTH") rejectedKey ??= error;
      return { path: item.path, error };
    }
  });
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

        const patterns = typeof input.files === "string" ? [input.files] : input.files;
        const roots = await filesRoots(deps.env ?? process.env, () => listClientRoots(server));
        const { items, skipped } = await selectFiles(patterns, roots);
        const results = await askFiles(client, items, questions, input, thresholds, signal);
        const answered = results.filter((r) => "answers" in r);
        const failed = results.filter((r) => "error" in r);
        // Nothing answered: surface the first failure (e.g. AUTH) as the tool error it is.
        if (answered.length === 0 && failed[0]) throw failed[0].error;

        const errors: Record<string, string> = { ...skipped };
        for (const f of failed) {
          const c = classify(f.error);
          errors[f.path] = redact(`${c.category}: ${c.hint}${c.detail ? ` ${c.detail}` : ""}`);
        }
        const files = Object.fromEntries(answered.map((r) => [r.path, r.answers]));
        const usage = answered.reduce((u, r) => addUsage(u, r.usage), { input_tokens: 0, output_tokens: 0 });
        return ok(askOutput.parse({ files, ...(Object.keys(errors).length > 0 ? { errors } : {}) }), {
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
