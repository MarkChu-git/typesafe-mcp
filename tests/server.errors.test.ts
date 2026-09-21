import { afterEach, describe, expect, test } from "bun:test";
import type { Fetch } from "@typesafe-ai/sdk";
import { resetClient } from "../src/client.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { inProcessClient } from "./helpers/mcp.ts";

const textOf = (result: { content?: Array<{ type: string; text?: string }> }): string => {
  const block = result.content?.[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") return "";
  return block.text;
};

const checkArgs = { state: "Help!", question: "Is this urgent?" };

// Never resolves on its own; rejects only when the SDK's timeout aborts the signal —
// mirroring how a real fetch surfaces an abort.
const hangingFetch: Fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    });
  });

const expectServerAlive = async (client: {
  listTools: () => Promise<{ tools: unknown[] }>;
}): Promise<void> => {
  const listed = await client.listTools();
  expect(listed.tools).toHaveLength(5);
};

describe("server error paths", () => {
  afterEach(() => {
    resetClient();
  });

  test("429 on every attempt → RATE_LIMIT, then server still lists tools", async () => {
    const ff = fakeFetch({
      "/v1/systemone": [
        { status: 429, body: loadFixture("error.429.json") },
        { status: 429, body: loadFixture("error.429.json") },
        { status: 429, body: loadFixture("error.429.json") },
      ],
    });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({ name: "jev_check", arguments: checkArgs });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("RATE_LIMIT");
      expect(textOf(r)).toContain("jev_ask");
      expect(ff.calls).toHaveLength(3);
      await expectServerAlive(client);
    } finally {
      await close();
    }
  });

  test("529 on every attempt → OVERLOADED, then server still lists tools", async () => {
    const ff = fakeFetch({
      "/v1/systemone": [
        { status: 529, body: loadFixture("error.529.json") },
        { status: 529, body: loadFixture("error.529.json") },
        { status: 529, body: loadFixture("error.529.json") },
      ],
    });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({ name: "jev_check", arguments: checkArgs });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("OVERLOADED");
      expect(ff.calls).toHaveLength(3);
      await expectServerAlive(client);
    } finally {
      await close();
    }
  });

  test("request exceeding TYPESAFE_TIMEOUT_MS → TIMEOUT, then server still lists tools", async () => {
    const { client, close } = await inProcessClient({
      fetch: hangingFetch,
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_TIMEOUT_MS: "50" },
    });
    try {
      const r = await client.callTool({ name: "jev_check", arguments: checkArgs });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("TIMEOUT");
      await expectServerAlive(client);
    } finally {
      await close();
    }
  });

  test("422 → INVALID_REQUEST with the offending field path", async () => {
    const ff = fakeFetch({
      "/v1/systemone": { status: 422, body: loadFixture("error.422.json") },
    });
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
    });
    try {
      const r = await client.callTool({ name: "jev_check", arguments: checkArgs });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("INVALID_REQUEST");
      expect(textOf(r)).toContain("questions.q.criteria");
      await expectServerAlive(client);
    } finally {
      await close();
    }
  });
});
