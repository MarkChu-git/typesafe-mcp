import { describe, expect, test } from "bun:test";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  RateLimitError,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import * as z from "zod/v4";
import { ConfigError, redact, toToolError } from "../src/errors.ts";

const headers = (requestId?: string): Headers => {
  const h = new Headers();
  if (requestId) h.set("x-typesafe-request-id", requestId);
  return h;
};

const textOf = (err: unknown, tool = "jev_check"): string => {
  const result = toToolError(err, { tool });
  expect(result.isError).toBe(true);
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected text content");
  return block.text;
};

describe("toToolError", () => {
  test("maps ConfigError to CONFIG", () => {
    const text = textOf(new ConfigError("missing"));
    expect(text.startsWith("CONFIG")).toBe(true);
    expect(text).toContain("TYPESAFE_API_KEY");
  });

  test("maps 401 AuthenticationError to AUTH", () => {
    const text = textOf(new AuthenticationError(401, { error: "invalid api key" }, headers("req-401")));
    expect(text.startsWith("AUTH")).toBe(true);
    expect(text).toContain("request_id req-401");
  });

  test("maps 422 UnprocessableEntityError to INVALID_REQUEST", () => {
    const body = { detail: [{ loc: ["body", "questions", "q", "criteria"], msg: "invalid criteria" }] };
    const text = textOf(new UnprocessableEntityError(422, body, headers("req-422")));
    expect(text.startsWith("INVALID_REQUEST")).toBe(true);
    expect(text).toContain("questions.q.criteria");
  });

  test("maps 429 RateLimitError to RATE_LIMIT", () => {
    const text = textOf(new RateLimitError(429, { error: "slow down" }, headers()));
    expect(text.startsWith("RATE_LIMIT")).toBe(true);
    expect(text).toContain("jev_ask");
  });

  test("maps 529 APIError to OVERLOADED", () => {
    const text = textOf(new APIError(529, { error: "overloaded" }, headers("req-529")));
    expect(text.startsWith("OVERLOADED")).toBe(true);
  });

  test("maps APITimeoutError to TIMEOUT", () => {
    const text = textOf(new APITimeoutError(10_000));
    expect(text.startsWith("TIMEOUT")).toBe(true);
    expect(text).toContain("state");
  });

  test("maps APIConnectionError to NETWORK", () => {
    const text = textOf(new APIConnectionError("dns"));
    expect(text.startsWith("NETWORK")).toBe(true);
  });

  test("maps ZodError to VALIDATION", () => {
    const parsed = z.object({ state: z.string().min(1) }).safeParse({ state: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const text = textOf(parsed.error);
    expect(text.startsWith("VALIDATION")).toBe(true);
    expect(text).toContain("state");
  });
});

describe("redact", () => {
  test("replaces the API key and prefixes of 5+ characters with ***", () => {
    const key = "ts_live_secret_value_xyz";
    const text = redact(`failed for ${key} Bearer ${key} leftover`, key);
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.slice(0, 5));
    expect(text).toContain("***");
  });
});
