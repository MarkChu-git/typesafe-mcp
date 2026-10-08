import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { META_KEY } from "../src/result.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

describe("jev_score", () => {
  afterEach(() => {
    resetClient();
  });

  test("1.05/0.92 → act; detailed probabilities keyed by level index", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("score.105.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_TOOLS: "score" },
    });
    try {
      const levels = ["Calm", "Frustrated", "Very angry"];
      const args = {
        state: "Help! My payouts have been failing for 3 days.",
        question: "How frustrated is the customer?",
        levels,
      };
      const r = await client.callTool({ name: "jev_score", arguments: args });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({ answer: 1.05, certainty: 0.92, decision: "act" });
      expect(r._meta?.[META_KEY]).toMatchObject({ model: "jev-1.13.0" });
      expect(ff.calls[0]?.body).toMatchObject({
        questions: { q: { type: "score", criteria: levels } },
      });

      const detailed = await client.callTool({ name: "jev_score", arguments: { ...args, detailed: true } });
      const sc = detailed.structuredContent as { probabilities: Record<string, number> };
      expect(sc.probabilities).toEqual({ "0": 0, "1": 0.95, "2": 0.05 });
      expect(Object.keys(sc.probabilities)).toHaveLength(levels.length);
    } finally {
      await close();
    }
  });
});
