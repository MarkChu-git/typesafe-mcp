import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

const listNames = async (env: Record<string, string>): Promise<string[]> => {
  const { client, close } = await inProcessClient({ env: { TYPESAFE_API_KEY: "test-key", ...env } });
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await close();
  }
};

describe("createServer", () => {
  afterEach(() => {
    resetClient();
  });

  test("exposes only jev_ask by default, and jev_ask succeeds", async () => {
    const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("check.yes095.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual(["jev_ask"]);
      const r = await client.callTool({
        name: "jev_ask",
        arguments: { state: "Help!", questions: { q: { type: "noul", question: "Is this urgent?" } } },
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({ answers: { q: { answer: true, certainty: 0.9, decision: "act" } } });
    } finally {
      await close();
    }
  });

  test("TYPESAFE_TOOLS=all lists all 5 tools in a stable order", async () => {
    const { client, close } = await inProcessClient({
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_TOOLS: "all" },
    });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual([
        "jev_ask",
        "jev_check",
        "jev_classify",
        "jev_score",
        "jev_models",
      ]);
      for (const tool of listed.tools) {
        expect(tool.description?.toLowerCase()).toContain("does not generate text");
      }
    } finally {
      await close();
    }
  });

  test("TYPESAFE_TOOLS takes short or full names in any order and skips unknown ones", async () => {
    expect(await listNames({ TYPESAFE_TOOLS: "models, jev_check nope" })).toEqual(["jev_check", "jev_models"]);
    expect(await listNames({ TYPESAFE_TOOLS: "nope" })).toEqual(["jev_ask"]);
  });
});
