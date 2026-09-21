import { describe, expect, test } from "bun:test";
import { toNoulQuestion } from "../src/questions.ts";

describe("toNoulQuestion", () => {
  test("sets type noul and passes criteria through", () => {
    const criteria = { true: "time-sensitive", false: "no urgency" };
    const q = toNoulQuestion({ question: "Does this message convey urgency?", criteria });
    expect(q.type).toBe("noul");
    expect(q.instructions).toBe("Does this message convey urgency?");
    expect(q.criteria).toEqual(criteria);
  });
});
