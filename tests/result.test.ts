import { describe, expect, test } from "bun:test";
import { META_KEY, ok } from "../src/result.ts";

describe("ok", () => {
  test("returns text JSON plus structuredContent", () => {
    const structured = { answer: true, certainty: 0.9, decision: "act" };
    const result = ok(structured);
    expect(result.structuredContent).toEqual(structured);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(structured) }]);
    expect(result._meta).toBeUndefined();
  });

  test("puts request details under _meta only", () => {
    const meta = { model: "jev-1.13.0", usage: { input_tokens: 10, output_tokens: 2 } };
    const result = ok({ answer: true }, meta);
    expect(result._meta).toEqual({ [META_KEY]: meta });
    expect(result.content[0].text).toBe('{"answer":true}');
  });
});
