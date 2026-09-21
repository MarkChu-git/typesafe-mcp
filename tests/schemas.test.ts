import { describe, expect, test } from "bun:test";
import { checkInput, modelsInput, stateSchema } from "../src/schemas.ts";

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
