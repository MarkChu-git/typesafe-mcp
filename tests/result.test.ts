import { describe, expect, test } from "bun:test";
import { ok } from "../src/result.ts";

describe("ok", () => {
  test("returns text JSON plus structuredContent", () => {
    const structured = { probability: 0.95, answer: true };
    const result = ok(structured);
    expect(result.structuredContent).toEqual(structured);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(structured) }]);
  });
});
