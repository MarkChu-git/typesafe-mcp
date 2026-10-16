import { afterEach, describe, expect, test } from "bun:test";
import { getClient, resetClient } from "../src/client.ts";
import { ConfigError } from "../src/errors.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";

describe("getClient", () => {
  afterEach(() => {
    resetClient();
  });

  test("throws ConfigError when the key is missing", () => {
    expect(() => getClient({ env: {} })).toThrow(ConfigError);
  });

  test("throws ConfigError when the key is whitespace", () => {
    expect(() => getClient({ env: { TYPESAFE_API_KEY: "  " } })).toThrow(ConfigError);
  });

  test("returns the same instance when a key is present", () => {
    const env = { TYPESAFE_API_KEY: "test-key" };
    const a = getClient({ env });
    const b = getClient({ env });
    expect(a).toBe(b);
  });

  test("reads responses under Bun, where SDK 0.7.0's lock on each body used it up (typesafe-sdk-js#20)", async () => {
    const ff = fakeFetch({ "/v1/models": { body: loadFixture("models.ok.json") } });
    const client = getClient({ env: { TYPESAFE_API_KEY: "test-key" }, fetch: ff.fetch });
    expect((await client.models.list()).length).toBeGreaterThan(0);
  });
});
