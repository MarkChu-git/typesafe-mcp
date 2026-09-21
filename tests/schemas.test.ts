import { describe, expect, test } from "bun:test";
import { askInput, checkInput, classifyInput, modelsInput, scoreInput, stateSchema } from "../src/schemas.ts";

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
