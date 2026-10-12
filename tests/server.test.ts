import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { ASK_INSTRUCTIONS } from "../src/tools/ask.ts";
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

  test("instructions say when to reach for jev_ask in at most 1,000 characters, since hosts show them on every call", () => {
    expect(ASK_INSTRUCTIONS.length).toBeLessThanOrEqual(1_000);
    expect(ASK_INSTRUCTIONS).toContain("jev_ask");
    expect(ASK_INSTRUCTIONS).toContain("review or abstain");
  });

  test("instructions keep the lines the willingness eval measured; rewording them means rerunning it", () => {
    // Unprompted agents used Jev on judgment tasks once told to ask before reading or grepping the files
    // themselves, even in a small repo (the reason they gave for skipping it), and to count picking a
    // feature's files as a judgment; exact lookups left to grep kept them off the control task.
    expect(ASK_INSTRUCTIONS).toContain("before you read or grep");
    expect(ASK_INSTRUCTIONS).toContain("even in a small repo");
    expect(ASK_INSTRUCTIONS).toContain("which files belong to a feature");
    expect(ASK_INSTRUCTIONS).toMatch(/exact lookups.*in grep or code/);
  });

  test("sends instructions on when to use jev_ask, only when jev_ask is exposed", async () => {
    const withAsk = await inProcessClient({ env: { TYPESAFE_API_KEY: "test-key" } });
    try {
      expect(withAsk.client.getInstructions()).toBe(ASK_INSTRUCTIONS);
    } finally {
      await withAsk.close();
    }
    const withoutAsk = await inProcessClient({ env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_TOOLS: "check" } });
    try {
      expect(withoutAsk.client.getInstructions()).toBeUndefined();
    } finally {
      await withoutAsk.close();
    }
  });

  test("TYPESAFE_TOOLS takes short or full names in any order and skips unknown ones", async () => {
    expect(await listNames({ TYPESAFE_TOOLS: "models, jev_check nope" })).toEqual(["jev_check", "jev_models"]);
    expect(await listNames({ TYPESAFE_TOOLS: "nope" })).toEqual(["jev_ask"]);
  });
});
