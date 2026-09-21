import { afterEach, describe, expect, test } from "bun:test";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

describe("createServer", () => {
  afterEach(() => {
    resetClient();
  });

  test("lists jev_models and jev_check, then jev_check succeeds", async () => {
    const ff = fakeFetch({
      "/v1/models": { body: loadFixture("models.ok.json") },
      "/v1/systemone": { body: loadFixture("check.yes095.json") },
    });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual(["jev_models", "jev_check"]);
      for (const tool of listed.tools) {
        expect(tool.description?.toLowerCase()).toContain("does not generate text");
      }
      const r = await client.callTool({
        name: "jev_check",
        arguments: { state: "Help!", question: "Is this urgent?" },
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({ probability: 0.95, decision: "act" });
    } finally {
      await close();
    }
  });
});
