import { describe, expect, test } from "bun:test";
import { redactAll } from "../../evals/harness/redact.ts";

describe("redactAll", () => {
  test("redacts Bearer tokens", () => {
    const text = "Authorization: Bearer abc.def.ghi";
    const result = redactAll(text, []);
    expect(result).toContain("Bearer ***");
  });

  test("replaces secrets of length >= 8", () => {
    const planted = "12345678";
    const text = `API key is ${planted}`;
    const result = redactAll(text, [planted]);
    expect(result).toBe("API key is ***");
  });

  test("does not replace short secrets", () => {
    const planted = "short";
    const text = `API key is ${planted}`;
    const result = redactAll(text, [planted]);
    expect(result).toContain("short");
  });

  test("redacts secrets inside JSON", () => {
    const planted = "sk_test_12345678";
    const text = JSON.stringify({
      result: "ok",
      key: planted,
    });
    const result = redactAll(text, [planted]);
    expect(result).toContain("***");
    expect(result).not.toContain("sk_test");
  });

  test("handles multiple secrets", () => {
    const planted1 = "longsecret1";
    const planted2 = "longsecret2";
    const text = `Keys: ${planted1} and ${planted2}`;
    const result = redactAll(text, [planted1, planted2]);
    expect(result).toBe("Keys: *** and ***");
  });

  test("does not redact if secret is not complete", () => {
    const planted = "verylongsecretkey";
    const text = `Start with ${planted.substring(0, 10)}`;
    const result = redactAll(text, [planted]);
    expect(result).toContain("verylongse");
  });
});
