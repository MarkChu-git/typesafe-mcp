import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

describe("jev_classify", () => {
  afterEach(() => {
    resetClient();
  });

  test("billing/0.81 → act, probabilities keyed by options", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("classify.billing081.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const options = { billing: "Payments", technical: "Bugs", sales: null };
      const r = await client.callTool({
        name: "jev_classify",
        arguments: {
          state: { ticket: "Help! My payouts have been failing for 3 days." },
          question: "Which team should handle `ticket`?",
          options,
        },
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        type: "choice",
        choice: "billing",
        confidence: 0.81,
        certainty: 0.81,
        decision: "act",
        model: "jev-1.13.0",
      });
      const sc = r.structuredContent as { probabilities: Record<string, number> };
      expect(new Set(Object.keys(sc.probabilities))).toEqual(new Set(Object.keys(options)));
      expect(ff.calls[0]?.body).toMatchObject({
        questions: { q: { type: "choice", criteria: options } },
      });
      expect(ff.calls).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
