import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

describe("jev_score", () => {
  afterEach(() => {
    resetClient();
  });

  test("1.05/0.92 → act, legend index strings align with levels", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("score.105.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const levels = ["Calm", "Frustrated", "Very angry"];
      const r = await client.callTool({
        name: "jev_score",
        arguments: {
          state: "Help! My payouts have been failing for 3 days.",
          question: "How frustrated is the customer?",
          levels,
        },
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        type: "score",
        score: 1.05,
        confidence: 0.92,
        certainty: 0.92,
        decision: "act",
        model: "jev-1.13.0",
      });
      const sc = r.structuredContent as { legend: Record<string, string | null> };
      expect(sc.legend).toEqual({ "0": "Calm", "1": "Frustrated", "2": "Very angry" });
      expect(Object.keys(sc.legend)).toHaveLength(levels.length);
      expect(ff.calls[0]?.body).toMatchObject({
        questions: { q: { type: "score", criteria: levels } },
      });
      expect(ff.calls).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
