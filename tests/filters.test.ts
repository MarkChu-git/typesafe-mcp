import { describe, expect, test } from "bun:test";
import { FilesError } from "../src/errors.ts";
import {
  capErrors,
  MAX_ERRORS,
  selector,
  typesOf,
  type Answered,
  type QuestionTypes,
  type RawAnswer,
  type SelectOptions,
} from "../src/filters.ts";
import { toAnswer } from "../src/gating.ts";
import { askInput, parseWhere } from "../src/schemas.ts";

const types = typesOf({
  urgent: { type: "noul" },
  dept: { type: "choice" },
  anger: { type: "score" },
});

const noul = (p: number): RawAnswer => ({ type: "noul", noul: p });
const choice = (label: string, confidence: number): RawAnswer => ({
  type: "choice",
  choice: label,
  confidence,
  probabilities: { [label]: confidence },
});
// A literal checked against ScoreResponse's legend type nests too deep for tsc under SDK 0.7.0.
const score = (level: number, confidence: number): RawAnswer =>
  ({ type: "score", score: level, confidence, legend: {}, probabilities: {} }) as unknown as RawAnswer;

/** A record whose shaped answers come from `toAnswer`, so they agree with the raw ones as in the tool. */
const record = (key: string, raw: Record<string, RawAnswer>): Answered => ({
  key,
  raw,
  answers: Object.fromEntries(Object.entries(raw).map(([id, a]) => [id, toAnswer(a, { act_above: 0.8, review_above: 0.5 })])),
});

/**
 * urgent (answer, certainty → decision), dept, anger:
 *   t1  yes .9 act       billing act       2.0
 *   t2  no  .9 act       technical review  0.4
 *   t3  yes .2 abstain   billing abstain   1.5
 *   t4  yes .9 act       sales act         1.0
 *   t5  yes 0  abstain   billing act       0.0
 *   t6  no  .6 review    sales review      2.0
 */
const records: Answered[] = [
  record("t1", { urgent: noul(0.95), dept: choice("billing", 0.9), anger: score(2, 0.9) }),
  record("t2", { urgent: noul(0.05), dept: choice("technical", 0.6), anger: score(0.4, 0.9) }),
  record("t3", { urgent: noul(0.6), dept: choice("billing", 0.3), anger: score(1.5, 0.55) }),
  record("t4", { urgent: noul(0.95), dept: choice("sales", 0.9), anger: score(1, 0.9) }),
  record("t5", { urgent: noul(0.5), dept: choice("billing", 0.9), anger: score(0, 0.9) }),
  record("t6", { urgent: noul(0.2), dept: choice("sales", 0.7), anger: score(2, 0.9) }),
];

const byKey = (key: string): Answered => {
  const found = records.find((r) => r.key === key);
  if (!found) throw new Error(`no record ${key}`);
  return found;
};

/** Options as the agent writes them: `where` before parseWhere splits `$or` off. */
type Written = Omit<SelectOptions, "where"> & { where?: Record<string, unknown> };
const select = ({ where, ...rest }: Written, declared: QuestionTypes = types) =>
  selector(where === undefined ? rest : { ...rest, where: parseWhere(where) }, declared);
const run = (options: Written, from: readonly Answered[] = records) => select(options)(from);
const keysOf = (options: Written): string[] => Object.keys(run(options).files ?? {});

describe("selector: where", () => {
  test("a value, or a list of values, matches the answer of a noul or choice question", () => {
    expect(keysOf({ where: { urgent: true } })).toEqual(["t1", "t3", "t4", "t5"]);
    expect(keysOf({ where: { urgent: false } })).toEqual(["t2", "t6"]);
    expect(keysOf({ where: { urgent: [true] } })).toEqual(["t1", "t3", "t4", "t5"]);
    expect(keysOf({ where: { urgent: [true, false] } })).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(keysOf({ where: { dept: "billing" } })).toEqual(["t1", "t3", "t5"]);
    expect(keysOf({ where: { dept: ["technical", "sales"] } })).toEqual(["t2", "t4", "t6"]);
  });

  test("a noul question also takes yes and no, the words its description uses, in any case", () => {
    expect(keysOf({ where: { urgent: "yes" } })).toEqual(keysOf({ where: { urgent: true } }));
    expect(keysOf({ where: { urgent: "No" } })).toEqual(keysOf({ where: { urgent: false } }));
    expect(keysOf({ where: { urgent: { is: ["YES", false] } } })).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(keysOf({ where: { urgent: { is: "true", decision: "act" } } })).toEqual(["t1", "t4"]);
    expect(keysOf({ where: { urgent: " Yes " } })).toEqual(keysOf({ where: { urgent: true } }));
  });

  test("{ is } says the same as the shorthand", () => {
    expect(keysOf({ where: { dept: { is: "billing" } } })).toEqual(keysOf({ where: { dept: "billing" } }));
    expect(keysOf({ where: { urgent: { is: [false] } } })).toEqual(["t2", "t6"]);
  });

  test("min and max bound a score's answer, inclusive", () => {
    expect(keysOf({ where: { anger: { min: 1.5 } } })).toEqual(["t1", "t3", "t6"]);
    expect(keysOf({ where: { anger: { max: 1 } } })).toEqual(["t2", "t4", "t5"]);
    expect(keysOf({ where: { anger: { min: 1, max: 1.5 } } })).toEqual(["t3", "t4"]);
    expect(keysOf({ where: { anger: { min: 2, max: 2 } } })).toEqual(["t1", "t6"]);
  });

  test("decision is one of the values or the list", () => {
    expect(keysOf({ where: { urgent: { decision: "act" } } })).toEqual(["t1", "t2", "t4"]);
    expect(keysOf({ where: { urgent: { decision: ["act", "review"] } } })).toEqual(["t1", "t2", "t4", "t6"]);
    expect(keysOf({ where: { dept: { decision: "abstain" } } })).toEqual(["t3"]);
    expect(keysOf({ where: { anger: { decision: ["review"] } } })).toEqual(["t3"]);
  });

  test("every key of a condition must hold, and every question's condition", () => {
    expect(keysOf({ where: { urgent: { is: true, decision: "act" } } })).toEqual(["t1", "t4"]);
    expect(keysOf({ where: { urgent: true, dept: "billing" } })).toEqual(["t1", "t3", "t5"]);
    expect(keysOf({ where: { urgent: true, dept: "billing", anger: { min: 1 } } })).toEqual(["t1", "t3"]);
    expect(keysOf({ where: { urgent: { decision: "act" }, dept: { is: ["sales", "billing"], decision: "act" }, anger: { max: 1.5 } } })).toEqual(["t4"]);
  });

  test("the result carries the answers, total and matched, and nothing else", () => {
    const result = run({ where: { dept: "sales" } });
    expect(result).toEqual({
      files: { t4: byKey("t4").answers, t6: byKey("t6").answers },
      total: 6,
      matched: 2,
    });
    expect(result.files?.["t4"]?.["urgent"]).toEqual({ answer: true, certainty: 0.9, decision: "act" });
  });

  test("$or keeps the records matching at least one of its objects, while the other conditions all still hold", () => {
    expect(keysOf({ where: { $or: [{ dept: "sales" }, { anger: { min: 2 } }] } })).toEqual(["t1", "t4", "t6"]);
    expect(keysOf({ where: { urgent: true, $or: [{ dept: "sales" }, { anger: { min: 2 } }] } })).toEqual(["t1", "t4"]);
    expect(keysOf({ where: { $or: [{ urgent: true, dept: "billing" }, { urgent: false, dept: "sales" }] } })).toEqual([
      "t1",
      "t3",
      "t5",
      "t6",
    ]);
    expect(run({ where: { $or: [{ dept: "sales" }, { anger: { min: 2 } }] } })).toMatchObject({ total: 6, matched: 3 });
  });

  test("nothing matching leaves an empty files; an empty where keeps everything", () => {
    expect(run({ where: { anger: { min: 3 } } })).toEqual({ files: {}, total: 6, matched: 0 });
    expect(run({ where: {} })).toMatchObject({ total: 6, matched: 6 });
    expect(keysOf({ where: {} })).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
  });
});

describe("selector: where is checked before any record exists", () => {
  const message = (options: Written): string => {
    try {
      select(options);
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).category).toBe("VALIDATION");
      return (error as FilesError).message;
    }
    throw new Error("expected selector to throw");
  };

  test("an unknown question id", () => {
    expect(message({ where: { nope: true } })).toBe("where.nope: unknown question id");
    expect(message({ where: { toString: true } })).toBe("where.toString: unknown question id");
  });

  test("a value of the wrong kind for the question's type", () => {
    expect(message({ where: { dept: true } })).toBe("where.dept: a choice question takes an option label");
    expect(message({ where: { dept: ["billing", false] } })).toBe("where.dept: a choice question takes an option label");
    expect(message({ where: { anger: true } })).toBe("where.anger: a score question takes min and max");
    expect(message({ where: { anger: { is: "high" } } })).toBe("where.anger: a score question takes min and max");
    expect(message({ where: { urgent: "maybe" } })).toBe("where.urgent: a noul question takes true or false");
    expect(message({ where: { urgent: { is: [true, "constructor"] } } })).toBe("where.urgent: a noul question takes true or false");
  });

  test("min and max on anything but a score", () => {
    expect(message({ where: { urgent: { min: 0.5 } } })).toBe("where.urgent: min and max only apply to score questions");
    expect(message({ where: { dept: { max: 2 } } })).toBe("where.dept: min and max only apply to score questions");
  });

  test("min above max", () => {
    expect(message({ where: { anger: { min: 3, max: 1 } } })).toBe("where.anger: min 3 is above max 1");
  });

  test("the first problem is reported, in the order of the conditions", () => {
    expect(message({ where: { urgent: true, anger: { min: 2, max: 1 }, nope: false } })).toBe("where.anger: min 2 is above max 1");
  });

  test("a problem inside $or names the object it is in", () => {
    expect(message({ where: { $or: [{ urgent: true }, { nope: true }] } })).toBe("where.$or.1.nope: unknown question id");
    expect(message({ where: { $or: [{ anger: { min: 3, max: 1 } }] } })).toBe("where.$or.0.anger: min 3 is above max 1");
  });
});

describe("selector: top", () => {
  test("one id ranks by the exact level of a score and cuts to k", () => {
    expect(keysOf({ top: { by: "anger", k: 3 } })).toEqual(["t1", "t6", "t3"]);
    expect(keysOf({ top: { by: "anger", k: 1 } })).toEqual(["t1"]);
    expect(keysOf({ top: { by: "anger", k: 100 } })).toEqual(["t1", "t6", "t3", "t4", "t2", "t5"]);
  });

  test("a noul ranks by p(yes), not by its yes/no answer", () => {
    expect(keysOf({ top: { by: "urgent", k: 6 } })).toEqual(["t1", "t4", "t3", "t5", "t6", "t2"]);
  });

  test("the exact value decides where the rounded answers tie", () => {
    const close = [record("low", { anger: score(1.001, 0.9) }), record("high", { anger: score(1.004, 0.9) })];
    expect(close.map((r) => r.answers["anger"]?.answer)).toEqual([1, 1]);
    expect(Object.keys(run({ top: { by: "anger", k: 2 } }, close).files ?? {})).toEqual(["high", "low"]);
  });

  test("ties keep record order", () => {
    // t1 and t4 are both .95; t1 and t6 are both 2.
    expect(keysOf({ top: { by: "urgent", k: 2 } })).toEqual(["t1", "t4"]);
    expect(keysOf({ top: { by: "anger", k: 2 } })).toEqual(["t1", "t6"]);
    const same = ["z", "a", "m"].map((key) => record(key, { urgent: noul(0.7) }));
    expect(Object.keys(run({ top: { by: "urgent", k: 3 } }, same).files ?? {})).toEqual(["z", "a", "m"]);
  });

  test("a weighted sum adds weight × value over the entries", () => {
    // t1 1.95, t4 1.45, t3 1.35, t6 1.2, t5 .5, t2 .25
    expect(keysOf({ top: { by: { urgent: 1, anger: 0.5 }, k: 4 } })).toEqual(["t1", "t4", "t3", "t6"]);
    // A weight of 1 for a single id is the plain id.
    expect(keysOf({ top: { by: { anger: 1 }, k: 3 } })).toEqual(keysOf({ top: { by: "anger", k: 3 } }));
  });

  test("a negative weight ranks low values first", () => {
    // t5 .5, t4 -.05, t2 -.35, t3 -.9, t1 -1.05, t6 -1.8
    expect(keysOf({ top: { by: { urgent: 1, anger: -1 }, k: 3 } })).toEqual(["t5", "t4", "t2"]);
  });

  test("the files are listed best first, and total counts all answered records", () => {
    const result = run({ top: { by: "anger", k: 2 } });
    expect(Object.keys(result.files ?? {})).toEqual(["t1", "t6"]);
    expect(result.total).toBe(6);
    expect(result.matched).toBeUndefined();
  });

  test("top ranks what where lets through", () => {
    const result = run({ where: { dept: "billing" }, top: { by: "anger", k: 2 } });
    expect(Object.keys(result.files ?? {})).toEqual(["t1", "t3"]);
    expect(result.matched).toBe(3);
    expect(result.total).toBe(6);
  });

  const message = (options: Written): string => {
    try {
      select(options);
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).category).toBe("VALIDATION");
      return (error as FilesError).message;
    }
    throw new Error("expected selector to throw");
  };

  test("a choice question, an unknown id, no entries and a bad weight are refused", () => {
    expect(message({ top: { by: "dept", k: 1 } })).toBe("top: dept is a choice question; rank by a score or noul");
    expect(message({ top: { by: { urgent: 1, dept: 2 }, k: 1 } })).toBe("top: dept is a choice question; rank by a score or noul");
    expect(message({ top: { by: "nope", k: 1 } })).toBe("top: nope is not a question id");
    expect(message({ top: { by: "constructor", k: 1 } })).toBe("top: constructor is not a question id");
    expect(message({ top: { by: {}, k: 1 } })).toStartWith("top: by is empty");
    expect(message({ top: { by: { urgent: Number.POSITIVE_INFINITY }, k: 1 } })).toBe("top: the weight of urgent must be a finite number");
    expect(message({ top: { by: { anger: Number.NaN }, k: 1 } })).toBe("top: the weight of anger must be a finite number");
  });
});

describe("selector: counts", () => {
  test("keys are true/false for a noul, the label for a choice and the nearest level for a score", () => {
    expect(run({ counts: true }).counts).toEqual({
      urgent: { true: 4, false: 2 },
      dept: { billing: 3, technical: 1, sales: 2 },
      anger: { "0": 2, "1": 1, "2": 3 },
    });
  });

  test("a score counts under the rounded answer, half up", () => {
    const levels = [0.4, 0.5, 1.49, 1.5, 2.2].map((level, i) => record(`r${i}`, { anger: score(level, 0.9) }));
    expect(run({ counts: true }, levels).counts?.["anger"]).toEqual({ "0": 1, "1": 2, "2": 2 });
  });

  test("counts alone return the tallies and the total, without the records", () => {
    const result = run({ counts: true });
    expect(Object.keys(result).toSorted()).toEqual(["counts", "total"]);
    expect(result.total).toBe(6);
  });

  test("with where or top the records are returned too, and the tallies still cover every record", () => {
    const filtered = run({ where: { dept: "sales" }, counts: true });
    expect(Object.keys(filtered.files ?? {})).toEqual(["t4", "t6"]);
    expect(filtered.matched).toBe(2);
    expect(filtered.counts?.["dept"]).toEqual({ billing: 3, technical: 1, sales: 2 });
    const ranked = run({ top: { by: "anger", k: 1 }, counts: true });
    expect(Object.keys(ranked.files ?? {})).toEqual(["t1"]);
    expect(ranked.counts?.["urgent"]).toEqual({ true: 4, false: 2 });
  });

  test("counts: false asks for nothing", () => {
    const result = run({ counts: false });
    expect(Object.keys(result)).toEqual(["files"]);
  });

  test("with no records every question is tallied as empty", () => {
    expect(run({ counts: true }, [])).toEqual({ total: 0, counts: { urgent: {}, dept: {}, anger: {} } });
  });
});

describe("selector: without where, top or counts", () => {
  test("every answered record is returned in order and nothing else", () => {
    const result = run({});
    expect(Object.keys(result)).toEqual(["files"]);
    expect(Object.keys(result.files ?? {})).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(run({}, [])).toEqual({ files: {} });
  });
});

const entries = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [`k${i}`, `reason ${i}`]);

describe("capErrors", () => {
  test("no errors give nothing", () => {
    expect(capErrors([])).toEqual({});
  });

  test("up to the cap, every error is listed", () => {
    expect(capErrors(entries(2))).toEqual({ errors: { k0: "reason 0", k1: "reason 1" } });
    const full = capErrors(entries(MAX_ERRORS));
    expect(Object.keys(full.errors ?? {})).toHaveLength(MAX_ERRORS);
    expect(full.more_errors).toBeUndefined();
  });

  test("past the cap the first 20 are listed in order and the rest are counted", () => {
    const capped = capErrors(entries(27));
    expect(MAX_ERRORS).toBe(20);
    expect(Object.keys(capped.errors ?? {})).toEqual(entries(20).map(([key]) => key));
    expect(capped.errors?.["k19"]).toBe("reason 19");
    expect(capped.more_errors).toBe(7);
  });
});

describe("askInput: where, top and counts", () => {
  const base = { files: "tickets/*.md", questions: { q: { type: "noul", question: "Urgent?" } } };
  const issues = (extra: Record<string, unknown>): string[] => {
    const parsed = askInput.safeParse({ ...base, ...extra });
    return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  test("accepts the shorthands, the condition object and the rest", () => {
    const where = {
      a: true,
      b: "billing",
      c: ["billing", "sales"],
      d: { is: [true], decision: ["act", "review"] },
      e: { min: 1, max: 2.5 },
      f: { decision: "abstain" },
    };
    expect(issues({ where, top: { by: "q", k: 5 }, counts: true, items: "csv" })).toEqual([]);
    expect(issues({ top: { by: { q: 1, r: -0.5 }, k: 100 } })).toEqual([]);
  });

  test("a condition says something, in a form that makes sense", () => {
    expect(issues({ where: { q: {} } })).toEqual(["where.q: give at least one of is, min, max, decision"]);
    expect(issues({ where: { q: [] } })[0]).toStartWith("where.q:");
    expect(issues({ where: { q: 3 } })).toEqual([
      "where.q: expected true or false, a label, a list of them, or an object with is, min, max or decision",
    ]);
    expect(issues({ where: { q: { decision: "maybe" } } })[0]).toStartWith("where.q:");
    expect(issues({ where: { q: { gt: 1 } } })[0]).toContain('Unrecognized key: "gt"');
  });

  test("top needs k between 1 and 100, a whole number, and by", () => {
    for (const k of [0, 101, 1.5, "3"]) expect(issues({ top: { by: "q", k } })[0]).toStartWith("top.k:");
    expect(issues({ top: { by: "q" } })[0]).toStartWith("top.k:");
    expect(issues({ top: { k: 1 } })[0]).toStartWith("top.by:");
    expect(issues({ top: { by: "q", k: 1, extra: 1 } })[0]).toContain("Unrecognized key");
  });

  test("items is one of the modes", () => {
    for (const items of ["file", "lines", "jsonl", "json", "csv", "sections"]) expect(issues({ items })).toEqual([]);
    expect(issues({ items: "xml" })[0]).toStartWith("items:");
  });

  test("items, where, top and counts need files", () => {
    const withState = { state: "Help!", questions: base.questions };
    const stray = "items, where, top and counts are only used with files";
    for (const extra of [{ items: "lines" }, { where: { q: true } }, { top: { by: "q", k: 1 } }, { counts: true }]) {
      const parsed = askInput.safeParse({ ...withState, ...extra });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.message)).toEqual([stray]);
    }
    expect(askInput.safeParse(withState).success).toBe(true);
  });
});

describe("where: choice labels", () => {
  test("a label that is not among the options fails before any request", () => {
    const declared = typesOf({ dept: { type: "choice", options: { billing: null, sales: null } } });
    expect(() => select({ where: { dept: "biling" } }, declared)).toThrow('where.dept: "biling" is not one of its options');
    expect(() => select({ where: { dept: { is: ["billing", "sales"], decision: "act" } } }, declared)).not.toThrow();
  });
});
