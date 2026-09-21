import { afterEach, describe, expect, test } from "bun:test";
import { getClient, resetClient } from "../src/client.ts";
import { ConfigError } from "../src/errors.ts";

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
});
