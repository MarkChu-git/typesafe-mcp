import { describe, expect, test } from "bun:test";
import { askImagesInput, askInput, checkInput, classifyInput, modelsInput, scoreInput, stateSchema } from "../src/schemas.ts";

const issuesOf = (parsed: ReturnType<typeof askInput.safeParse>): string[] =>
  parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

const askIssues = (questions: Record<string, unknown>): string[] => issuesOf(askInput.safeParse({ state: "Help!", questions }));

describe("schemas batch 1", () => {
  test("rejects an empty string state", () => {
    const parsed = stateSchema.safeParse("");
    expect(parsed.success).toBe(false);
  });

  test("rejects inverted thresholds", () => {
    const parsed = checkInput.safeParse({
      state: "hello",
      question: "Is this urgent?",
      act_above: 0.4,
      review_above: 0.6,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes("review_above"))).toBe(true);
  });

  test("rejects an extra apiKey key", () => {
    const payload: Record<string, unknown> = {
      state: "hello",
      question: "Is this urgent?",
    };
    payload["apiKey"] = 1;
    const parsed = checkInput.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  test("rejects apiKey on jev_models", () => {
    const payload: Record<string, unknown> = {};
    payload["apiKey"] = 1;
    const parsed = modelsInput.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  test("accepts a valid check payload", () => {
    const parsed = checkInput.safeParse({
      state: "Help!",
      question: "Is this urgent?",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("schemas batch 2", () => {
  const base = { state: "Help!", question: "Which team?" };

  test("rejects a single-option classify", () => {
    const parsed = classifyInput.safeParse({ ...base, options: { billing: null } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain("at least 2 options");
  });

  test("rejects 256 options", () => {
    const options = Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`opt${i}`, null]),
    );
    const parsed = classifyInput.safeParse({ ...base, options });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain("at most 255");
  });

  test("accepts options with null rubrics", () => {
    const parsed = classifyInput.safeParse({
      ...base,
      options: { billing: "Payments", technical: null },
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects 11 levels", () => {
    const parsed = scoreInput.safeParse({
      ...base,
      levels: Array.from({ length: 11 }, (_, i) => `L${i}`),
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects an empty questions batch", () => {
    const parsed = askInput.safeParse({ state: "Help!", questions: {} });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain("at least one question");
  });

  test("batch error names the offending question id", () => {
    const parsed = askInput.safeParse({
      state: "Help!",
      questions: {
        urgent: { type: "noul", question: "Is this urgent?" },
        dept: { type: "choice", question: "Which team?", options: { only: null } },
      },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const text = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    expect(text).toContain("dept");
  });

  test("a question must carry its own type's field and no other type's", () => {
    expect(askIssues({ dept: { type: "choice", question: "Which team?" } })).toEqual([
      "questions.dept.options: required when type is choice",
    ]);
    expect(askIssues({ anger: { type: "score", question: "How angry?", options: { a: null, b: null } } })).toEqual([
      "questions.anger.options: not used when type is score",
      "questions.anger.levels: required when type is score",
    ]);
    expect(askIssues({ urgent: { type: "noul", question: "Urgent?", levels: ["no", "yes"] } })).toEqual([
      "questions.urgent.levels: not used when type is noul",
    ]);
    expect(askIssues({ urgent: { type: "noul", question: "Urgent?", criteria: { true: "act now" } } })).toEqual([]);
  });

  test("state is text, a JSON object or a non-empty JSON array", () => {
    expect(stateSchema.safeParse({ order: { items: [1, 2] } }).success).toBe(true);
    expect(stateSchema.safeParse([{ id: 1 }]).success).toBe(true);
    expect(stateSchema.safeParse([]).success).toBe(false);
    expect(stateSchema.safeParse(42).success).toBe(false);
  });

  test("accepts a valid mixed batch", () => {
    const parsed = askInput.safeParse({
      state: "Help!",
      questions: {
        urgent: { type: "noul", question: "Is this urgent?" },
        dept: {
          type: "choice",
          question: "Which team?",
          options: { billing: null, technical: null },
        },
        anger: { type: "score", question: "How angry?", levels: ["Calm", "Angry"] },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("box questions", () => {
  const button = { type: "box", question: "the Checkout button in `content`" };
  const there = { type: "noul", question: "Is there a Checkout button in `content`?" };

  test("with images on, a box question takes only its question, next to the other types", () => {
    expect(issuesOf(askImagesInput.safeParse({ files: "shots/*.png", questions: { there, button } }))).toEqual([]);
    const extras = { files: "shots/*.png", questions: { button: { ...button, options: { a: null, b: null }, criteria: { true: "yes" } } } };
    expect(issuesOf(askImagesInput.safeParse(extras))).toEqual([
      "questions.button.criteria: not used when type is box",
      "questions.button.options: not used when type is box",
    ]);
  });

  test("a box question needs an image, so it is refused with state", () => {
    expect(issuesOf(askImagesInput.safeParse({ state: "Help!", questions: { there, button } }))).toEqual([
      "questions.button: box needs an image, so pass PNG or JPEG files in files instead of state",
    ]);
  });

  test("with images off, a box question names the switch that turns it on", () => {
    expect(issuesOf(askInput.safeParse({ files: "shots/*.png", questions: { button } }))).toEqual([
      "questions.button.type: box needs images: set TYPESAFE_IMAGES=1 in the server env",
    ]);
  });
});
