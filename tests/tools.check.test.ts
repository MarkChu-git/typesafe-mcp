import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string => {
  const block = result.content[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("expected text content");
  }
  return block.text;
};

describe("jev_check", () => {
  afterEach(() => {
    resetClient();
  });

  test("0.95 → act / true", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("check.yes095.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({
        name: "jev_check",
        arguments: { state: "Help!", question: "Is this urgent?" },
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        probability: 0.95,
        answer: true,
        decision: "act",
        model: "jev-1.13.0",
      });
      expect(ff.calls[0]?.body).toMatchObject({
        state: "Help!",
        questions: { q: { type: "noul" } },
      });
    } finally {
      await close();
    }
  });

  test("0.52 → abstain / true", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("check.ambiguous052.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({
        name: "jev_check",
        arguments: { state: "ok", question: "Is this urgent?" },
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        probability: 0.52,
        answer: true,
        decision: "abstain",
      });
    } finally {
      await close();
    }
  });

  test("missing key → CONFIG", async () => {
    const { client, close } = await inProcessClient({ env: { TYPESAFE_API_KEY: "" } });
    try {
      const r = await client.callTool({
        name: "jev_check",
        arguments: { state: "Help!", question: "Is this urgent?" },
      });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/^CONFIG/);
      expect(textOf(r)).toContain("TYPESAFE_API_KEY");
    } finally {
      await close();
    }
  });
});
