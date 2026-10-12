import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { FilesError } from "./errors.ts";
import type { AskInput, AskQuestion, JevAnswer, Top, Where } from "./schemas.ts";

type QuestionType = AskQuestion["type"];

/** What `where`, `top` and `counts` need to know about a question: its type and, for a choice, its labels. */
export interface QuestionInfo {
  type: QuestionType;
  labels?: readonly string[];
}

/** Question id → its type and labels, as the agent declared them. */
export type QuestionTypes = Readonly<Record<string, QuestionInfo>>;

/** Jev's answer before rounding: `top` ranks by the exact probability or level. */
export type RawAnswer = NoulResponse | ChoiceResponse | ScoreResponse;

/** One record Jev answered. */
export interface Answered {
  key: string;
  /** What the agent reads. */
  answers: Readonly<Record<string, JevAnswer>>;
  /** What `top` reads. */
  raw: Readonly<Record<string, RawAnswer>>;
}

export interface SelectOptions {
  where?: Where | undefined;
  top?: Top | undefined;
  counts?: AskInput["counts"];
}

export interface Selection {
  /** Records passing `where`, ranked and cut by `top`; absent when only `counts` was asked for. */
  files?: Record<string, Readonly<Record<string, JevAnswer>>>;
  /** Records answered, before `where`; given with `where`, `top` or `counts`. */
  total?: number;
  /** Records passing `where`, before `top` cuts them. */
  matched?: number;
  /** Question id → answer → records giving it, over every answered record. */
  counts?: Record<string, Record<string, number>>;
}

export const typesOf = (
  questions: Readonly<Record<string, { type: QuestionType; options?: Readonly<Record<string, unknown>> | undefined }>>,
): QuestionTypes =>
  Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [id, q.options ? { type: q.type, labels: Object.keys(q.options) } : { type: q.type }]),
  );

/** An id the agent made up may be `toString`, which a plain lookup would find. */
const infoOf = (types: QuestionTypes, id: string): QuestionInfo | undefined => (Object.hasOwn(types, id) ? types[id] : undefined);

const whereError = (id: string, message: string): FilesError => new FilesError(`where.${id}: ${message}`);

const TAKES: Record<QuestionType, string> = { noul: "true or false", choice: "an option label", score: "min and max" };

/** The noul description calls its answers yes and no, so agents write those as often as true and false. */
const YES_NO = new Map([
  ["yes", true],
  ["no", false],
  ["true", true],
  ["false", false],
]);

const asNoul = (value: boolean | string): boolean | string =>
  typeof value === "string" ? (YES_NO.get(value.trim().toLowerCase()) ?? value) : value;

type Test = (answers: Readonly<Record<string, JevAnswer>>) => boolean;

/** The shorthand `value` means `{ is: value }`. */
function conditionOf(condition: Where[string]): Exclude<Where[string], boolean | string | unknown[]> {
  return typeof condition === "object" && !Array.isArray(condition) ? condition : { is: condition };
}

/** Everything a condition says about one question, checked against the question before any request. */
function compileCondition(id: string, info: QuestionInfo | undefined, condition: Where[string]): Test {
  if (info === undefined) throw whereError(id, "unknown question id");
  const { type, labels } = info;
  const { is, min, max, decision } = conditionOf(condition);
  const checks: ((answer: JevAnswer) => boolean)[] = [];
  if (is !== undefined) {
    const wanted = type === "noul" ? [is].flat().map(asNoul) : [is].flat();
    const kind = type === "noul" ? "boolean" : "string";
    if (type === "score" || wanted.some((v) => typeof v !== kind)) {
      throw whereError(id, `a ${type} question takes ${TAKES[type]}`);
    }
    // A mistyped label would match nothing after every request was paid for.
    const unknown = labels === undefined ? undefined : wanted.find((v) => !labels.includes(String(v)));
    if (unknown !== undefined) throw whereError(id, `"${String(unknown)}" is not one of its options`);
    checks.push((a) => wanted.some((v) => v === a.answer));
  }
  if (min !== undefined || max !== undefined) {
    if (type !== "score") throw whereError(id, "min and max only apply to score questions");
    if (min !== undefined && max !== undefined && min > max) throw whereError(id, `min ${min} is above max ${max}`);
    checks.push((a) => typeof a.answer === "number" && (min === undefined || a.answer >= min) && (max === undefined || a.answer <= max));
  }
  if (decision !== undefined) {
    const wanted = new Set([decision].flat());
    checks.push((a) => wanted.has(a.decision));
  }
  return (answers) => {
    const answer = answers[id];
    return answer !== undefined && checks.every((check) => check(answer));
  };
}

function compileWhere(where: Where, types: QuestionTypes): Test {
  const tests = Object.entries(where).map(([id, condition]) => compileCondition(id, infoOf(types, id), condition));
  return (answers) => tests.every((test) => test(answers));
}

/** The exact value `top` ranks by: a noul's probability of yes, a score's expected level. */
function level(answer: RawAnswer | undefined): number {
  switch (answer?.type) {
    case "noul":
      return answer.noul;
    case "score":
      return answer.score;
    default:
      return 0;
  }
}

/** Keeps the `k` records with the highest weighted sum; ties stay in record order. */
function compileTop(top: Top, types: QuestionTypes): (records: readonly Answered[]) => Answered[] {
  const weights: [string, number][] = typeof top.by === "string" ? [[top.by, 1]] : Object.entries(top.by);
  if (weights.length === 0) throw new FilesError("top: by is empty; name a score or noul question");
  for (const [id, weight] of weights) {
    const type = infoOf(types, id)?.type;
    if (type === undefined) throw new FilesError(`top: ${id} is not a question id`);
    if (type === "choice") throw new FilesError(`top: ${id} is a choice question; rank by a score or noul`);
    if (!Number.isFinite(weight)) throw new FilesError(`top: the weight of ${id} must be a finite number`);
  }
  const valueOf = (record: Answered): number => weights.reduce((sum, [id, weight]) => sum + weight * level(record.raw[id]), 0);
  return (records) =>
    records
      .map((record) => ({ record, value: valueOf(record) }))
      .toSorted((a, b) => b.value - a.value)
      .slice(0, top.k)
      .map(({ record }) => record);
}

/** How many records gave each answer; a score counts under its nearest level. */
function tally(records: readonly Answered[], types: QuestionTypes): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(types).map(([id, { type }]) => {
      const counts = new Map<string, number>();
      for (const record of records) {
        const answer = record.answers[id]?.answer;
        if (answer === undefined) continue;
        const value = type === "score" && typeof answer === "number" ? Math.round(answer) : answer;
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      }
      return [id, Object.fromEntries(counts)];
    }),
  );
}

/**
 * Checks `where` and `top` against the question types, so a mistake costs no Jev request, and returns
 * what to do with the answered records: keep those passing `where`, rank and cut them by `top`, and
 * tally all of them for `counts`. `counts` alone returns only the tallies.
 */
export function selector(options: SelectOptions, types: QuestionTypes): (records: readonly Answered[]) => Selection {
  const { where, top } = options;
  const test = where === undefined ? undefined : compileWhere(where, types);
  const rank = top === undefined ? undefined : compileTop(top, types);
  const counting = options.counts === true;
  const filtering = where !== undefined || top !== undefined;
  return (records) => {
    const passing = test ? records.filter((record) => test(record.answers)) : records;
    const kept = rank ? rank(passing) : passing;
    return {
      ...(counting && !filtering ? {} : { files: Object.fromEntries(kept.map((record) => [record.key, record.answers])) }),
      ...(counting || filtering ? { total: records.length } : {}),
      ...(where === undefined ? {} : { matched: passing.length }),
      ...(counting ? { counts: tally(records, types) } : {}),
    };
  };
}

/** Largest record text `unsure` carries, in UTF-8 bytes; a larger record stays out, for the agent to open if it must. */
export const MAX_UNSURE_BYTES = 2_000;
/** Text `unsure` carries in all, in UTF-8 bytes, so a call over many unsure records still returns a short result. */
export const MAX_UNSURE_TOTAL_BYTES = 16_000;

/**
 * The text of each returned record with a review or abstain answer, when small, in result order up to
 * MAX_UNSURE_TOTAL_BYTES; a record that no longer fits is skipped for a later, smaller one, and
 * `more_unsure` counts every record left out. Agents check those records, and reading them in the
 * result saves opening them in another step, which rereads the whole conversation. Bytes rather than
 * characters keep the budget near the same number of tokens in any script.
 */
export function unsureTexts(
  files: Selection["files"],
  textOf: (key: string) => string,
): { unsure?: Record<string, string>; more_unsure?: number } {
  const unsure: Record<string, string> = {};
  let total = 0;
  let left = 0;
  for (const [key, answers] of Object.entries(files ?? {})) {
    if (Object.values(answers).every((answer) => answer.decision === "act")) continue;
    const text = textOf(key);
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_UNSURE_BYTES || total + bytes > MAX_UNSURE_TOTAL_BYTES) {
      left += 1;
      continue;
    }
    unsure[key] = text;
    total += bytes;
  }
  return {
    ...(Object.keys(unsure).length > 0 ? { unsure } : {}),
    ...(left > 0 ? { more_unsure: left } : {}),
  };
}

/** Errors the result lists; a batch that fails as a whole would otherwise repeat one reason per record. */
export const MAX_ERRORS = 20;

/** The first `MAX_ERRORS` of `entries` (record key → reason), and how many more there were. */
export function capErrors(entries: readonly (readonly [string, string])[]): { errors?: Record<string, string>; more_errors?: number } {
  if (entries.length === 0) return {};
  const more = entries.length - MAX_ERRORS;
  return { errors: Object.fromEntries(entries.slice(0, MAX_ERRORS)), ...(more > 0 ? { more_errors: more } : {}) };
}
