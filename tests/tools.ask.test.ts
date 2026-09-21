import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

const textOf = (result: { content?: Array<{ type: string; text?: string }> }): string => {
  const block = result.content?.[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") return "";
  return block.text;
};

describe("jev_ask", () => {
  afterEach(() => {
    resetClient();
  });

  test("mixed batch of 3 → exactly one fetch, every answer has a decision", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("ask.mixed3.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({
        name: "jev_ask",
        arguments: {
          state: { ticket: "Help! My payouts have been failing for 3 days." },
          questions: {
            urgent: { type: "noul", question: "Does `ticket` convey urgency?" },
            dept: {
              type: "choice",
              question: "Which team should handle `ticket`?",
              options: { billing: null, technical: null, sales: null },
            },
            anger: {
              type: "score",
              question: "How frustrated is the customer?",
              levels: ["Calm", "Frustrated", "Very angry"],
            },
          },
        },
      });
      expect(r.isError).toBeFalsy();
      expect(ff.calls).toHaveLength(1);
      const sc = r.structuredContent as {
        answers: Record<string, { type: string; decision: string }>;
      };
      expect(new Set(Object.keys(sc.answers))).toEqual(new Set(["anger", "dept", "urgent"]));
      expect(sc.answers["urgent"]).toMatchObject({
        type: "noul",
        probability: 0.95,
        answer: true,
        decision: "act",
      });
      expect(sc.answers["dept"]).toMatchObject({
        type: "choice",
        choice: "billing",
        decision: "act",
      });
      expect(sc.answers["anger"]).toMatchObject({
        type: "score",
        score: 1.05,
        decision: "act",
      });
      for (const a of Object.values(sc.answers)) {
        expect(["act", "review", "abstain"]).toContain(a.decision);
      }
      const sent = ff.calls[0]?.body as { questions: Record<string, { type: string }> };
      expect(new Set(Object.keys(sent.questions))).toEqual(new Set(["anger", "dept", "urgent"]));
      expect(sent.questions["urgent"]?.type).toBe("noul");
      expect(sent.questions["dept"]?.type).toBe("choice");
      expect(sent.questions["anger"]?.type).toBe("score");
    } finally {
      await close();
    }
  });

  test("empty questions → rejected without a fetch", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("ask.mixed3.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({
        name: "jev_ask",
        arguments: { state: "Help!", questions: {} },
      });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("at least one question");
      expect(ff.calls).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
