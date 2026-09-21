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

describe("jev_models", () => {
  afterEach(() => {
    resetClient();
  });

  test("returns the fixture list and default model", async () => {
    const ff = fakeFetch({ "/v1/models": { body: loadFixture("models.ok.json") } });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({ name: "jev_models", arguments: {} });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        default_model: "jev-latest",
        models: [{ name: "jev-latest" }, { name: "jev-preview" }],
      });
    } finally {
      await close();
    }
  });

  test("maps 401 to AUTH", async () => {
    const ff = fakeFetch({
      "/v1/models": {
        status: 401,
        body: loadFixture("error.401.json"),
        headers: { "x-typesafe-request-id": "req-401" },
      },
    });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({ name: "jev_models", arguments: {} });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/^AUTH/);
    } finally {
      await close();
    }
  });
});
