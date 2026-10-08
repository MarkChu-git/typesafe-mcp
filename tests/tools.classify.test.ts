import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { META_KEY } from "../src/result.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

describe("jev_classify", () => {
  afterEach(() => {
    resetClient();
  });

  test("billing/0.81 → act; detailed probabilities keyed by options", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("classify.billing081.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_TOOLS: "classify" },
    });
    try {
      const options = { billing: "Payments", technical: "Bugs", sales: null };
      const args = {
        state: { ticket: "Help! My payouts have been failing for 3 days." },
        question: "Which team should handle `ticket`?",
        options,
      };
      const r = await client.callTool({ name: "jev_classify", arguments: args });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({ answer: "billing", certainty: 0.81, decision: "act" });
      expect(r._meta?.[META_KEY]).toMatchObject({ model: "jev-1.13.0" });
      expect(ff.calls[0]?.body).toMatchObject({
        questions: { q: { type: "choice", criteria: options } },
      });

      const detailed = await client.callTool({ name: "jev_classify", arguments: { ...args, detailed: true } });
      const sc = detailed.structuredContent as { probabilities: Record<string, number> };
      expect(new Set(Object.keys(sc.probabilities))).toEqual(new Set(Object.keys(options)));
      expect(ff.calls).toHaveLength(2);
    } finally {
      await close();
    }
  });
});
