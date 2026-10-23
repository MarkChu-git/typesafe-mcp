import type { McpServer } from "@modelcontextprotocol/server";
import { image, type EntryType, type TypeSafeClient, type Usage } from "@typesafe-ai/sdk";
import { getClient, type ClientDeps } from "../client.ts";
import { readConfig } from "../config.ts";
import { classify, FilesError, redact, toToolError } from "../errors.ts";
import { capErrors, MAX_UNSURE_BYTES, selector, typesOf, unsureTexts, type Answered } from "../filters.ts";
import { filesRoots, MAX_FILE_BYTES, MAX_SPLIT_FILE_BYTES, selectFiles, shown } from "../files.ts";
import { ANSWER_NOTE, thresholdsFrom, toAnswer, type Thresholds } from "../gating.ts";
import { MAX_SIDE, MIN_SIDE } from "../images.ts";
import { buildQuestions, hasBox, takesBox, toState, type JevQuestions } from "../questions.ts";
import { isPiece, MAX_RECORDS, splitFile, textOf, type ImagePiece, type Part, type Piece } from "../records.ts";
import { ok } from "../result.ts";
import { askImagesInput, askImagesOutput, askInput, askOutput, parseTop, parseWhere, type AskInput } from "../schemas.ts";

/**
 * Server instructions: hosts show them even while tool definitions are deferred, so they carry when to
 * use jev_ask, which the tool description alone cannot do for an agent that never loads it.
 */
export const ASK_INSTRUCTIONS =
  "Use jev_ask for judgments about many files or records: classifying, triaging, ranking, filtering, deciding which files belong to a feature or topic, or checking content against criteria or a policy. With more than about 50 of them, ask before you read or grep them yourself: one call answers all of them and keeps their text out of your context. A handful of short files is cheaper to read yourself. Pass globs in files, the policy in context, and use where, top or counts to get back only what you need. Jev reads each file in full and judges meaning, so it catches what keyword searches miss or wrongly match: reworded, negated or conditional statements, and files that only mention a topic. Every answer carries a certainty and an act/review/abstain decision: act answers rarely need checking, and short records marked review or abstain come back with their text in unsure, so settle those without opening the files. Keep exact lookups, such as matching IDs or summing amounts, in grep or code.";

/** Added to the instructions when `TYPESAFE_IMAGES` is on, since an agent cannot tell otherwise that Jev sees images. */
export const IMAGES_INSTRUCTIONS =
  "Jev also sees PNG and JPEG files, such as screenshots, so ask it about images too: each one you open yourself adds about a thousand tokens to your context.";

export const askInstructions = (images: boolean): string => (images ? `${ASK_INSTRUCTIONS} ${IMAGES_INSTRUCTIONS}` : ASK_INSTRUCTIONS);

export const ASK_DESCRIPTION = `Ask Jev, TypeSafe's decision model, typed questions about one state, or about every file or record that files matches, without reading them into your context. Ask every question about the same input in one call. Jev does not see question ids, so write each question to stand alone: plain English, literal, one judgment per question. With files, Jev sees {file, content, context}; refer to them by name, e.g. \`content\`. A score answer is the expected level index. ${ANSWER_NOTE} With files, records with a review or abstain answer come back with their text in \`unsure\` when it is at most ${MAX_UNSURE_BYTES.toLocaleString("en-US")} bytes; \`more_unsure\` counts the ones left out.`;

/** Added to the description when `TYPESAFE_IMAGES` is on. */
export const IMAGES_NOTE = `PNG and JPEG files reach Jev as images in \`content\`, ${MIN_SIDE}–${MAX_SIDE} px a side; an unsure image is only counted in \`more_unsure\`.`;

/** Added with `IMAGES_NOTE`, since `box` is a question type only then. TypeSafe's Box has no "not found" answer. */
export const BOX_NOTE = `A box answer is {top, bottom, left, right}, fractions of height and width from the top-left. Jev always gives a box, never "not found", so ask a noul in the same call whether the target is there.`;

export const askDescription = (images: boolean): string => (images ? `${ASK_DESCRIPTION} ${IMAGES_NOTE} ${BOX_NOTE}` : ASK_DESCRIPTION);

/** TypeSafe's opt-in for a request that carries an image or a box question, which it still calls experimental. */
const IMAGES_HEADER = { "TypeSafe-Danger-Zone-Images": "true" };

/** Why a text record in a call with a box question is not sent. */
const BOX_ON_TEXT = "text; box questions need a PNG or JPEG image";

/** Jev before 1.14 answers a box question with a bare 400 "Invalid request.", so the call fails first, naming a model that takes it. */
function checkBoxModel(asked: string | undefined, defaultModel: string): void {
  const model = asked ?? defaultModel;
  if (takesBox(model)) return;
  const which = asked === undefined ? `${model} (the server's default model)` : model;
  throw new FilesError(`box questions need Jev 1.14 or later, not ${which}; pass model "jev-1.14.0"`);
}

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

/** A total is unknown once any request did not report its count. */
const addTokens = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b);

const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: addTokens(a.input_tokens, b.input_tokens),
  output_tokens: addTokens(a.output_tokens, b.output_tokens),
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
  questions: JevQuestions,
  input: AskInput,
  thresholds: Thresholds,
  signal: AbortSignal,
): Promise<Outcome[]> {
  let rejectedKey: unknown;
  const boxes = hasBox(questions);
  return mapLimit(parts, REQUEST_CONCURRENCY, async (part): Promise<Outcome> => {
    if (!isPiece(part)) return part;
    if (signal.aborted) return { key: part.key, error: signal.reason };
    if (rejectedKey !== undefined) return { key: part.key, error: rejectedKey };
    const state: EntryType = {
      file: part.file,
      content: "image" in part ? image(part.image.bytes) : part.content,
      ...(input.context === undefined ? {} : { context: input.context as EntryType }),
    };
    try {
      const res = await client.systemOne(
        { state, questions, ...(input.model ? { model: input.model } : {}) },
        { signal, ...("image" in part || boxes ? { headers: IMAGES_HEADER } : {}) },
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

/** Each answered record's text as Jev got it, by record key, and none for an image; every answered key is a piece's. */
function textsOf(parts: readonly Part[]): (key: string) => string | undefined {
  const pieces = new Map<string, Piece | ImagePiece>(parts.filter(isPiece).map((part) => [part.key, part]));
  return (key) => {
    const piece = pieces.get(key);
    if (piece === undefined) return "";
    return "image" in piece ? undefined : textOf(piece.content);
  };
}

/** The record key and reason of an outcome without answers. */
function problemOf(outcome: Outcome): [string, string][] {
  if ("reason" in outcome) return [[outcome.key, outcome.reason]];
  if ("error" in outcome) return [[outcome.key, failureText(outcome.error)]];
  return [];
}

export function registerAsk(server: McpServer, deps: ClientDeps = {}): void {
  const { images, defaultModel } = readConfig(deps.env);
  server.registerTool(
    "jev_ask",
    {
      title: "Ask Jev",
      description: askDescription(images),
      inputSchema: images ? askImagesInput : askInput,
      outputSchema: images ? askImagesOutput : askOutput,
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
          return ok(askImagesOutput.parse({ answers }), { model: res.model, usage: res.usage, thresholds });
        }

        const mode = input.items ?? "file";
        // Before any file is read or request sent, so a mistake in where or top costs nothing.
        const where = input.where === undefined ? undefined : parseWhere(input.where);
        const top = input.top === undefined ? undefined : parseTop(input.top);
        const select = selector({ where, top, counts: input.counts }, typesOf(input.questions));
        const boxes = hasBox(input.questions);
        if (boxes) checkBoxModel(input.model, defaultModel);
        const patterns = typeof input.files === "string" ? [input.files] : input.files;
        const roots = await filesRoots(deps.env ?? process.env, () => listClientRoots(server), deps.cwd ?? process.cwd());
        const maxBytes = mode === "file" ? MAX_FILE_BYTES : MAX_SPLIT_FILE_BYTES;
        const { items, skipped } = await selectFiles(patterns, roots, maxBytes, images);
        const parts = items
          .flatMap((item) => splitFile(item, mode))
          .map((part): Part => (boxes && isPiece(part) && !("image" in part) ? { key: part.key, reason: BOX_ON_TEXT } : part));
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
        const usage = answered.reduce<Usage>((u, r) => addUsage(u, r.usage), { input_tokens: 0, output_tokens: 0 });
        const selection = select(answered);
        const unsure = unsureTexts(selection.files, textsOf(parts));
        return ok(askImagesOutput.parse({ ...selection, ...unsure, ...capErrors(problems) }), {
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
