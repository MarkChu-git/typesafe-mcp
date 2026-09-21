import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL, DEFAULT_THRESHOLDS, DEFAULT_TIMEOUT_MS, readConfig } from "../src/config.ts";

describe("readConfig", () => {
  test("treats a blank key as missing", () => {
    const cfg = readConfig({ TYPESAFE_API_KEY: "   " });
    expect(cfg.apiKey).toBeUndefined();
  });

  test("defaults the model to jev-latest", () => {
    const cfg = readConfig({});
    expect(cfg.defaultModel).toBe(DEFAULT_MODEL);
    expect(cfg.defaultModel).toBe("jev-latest");
  });

  test("honors TYPESAFE_DEFAULT_MODEL", () => {
    const cfg = readConfig({ TYPESAFE_DEFAULT_MODEL: "jev-1.13.0" });
    expect(cfg.defaultModel).toBe("jev-1.13.0");
  });

  test("defaults timeout to 10000", () => {
    expect(readConfig({}).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  test("exports default thresholds", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ act_above: 0.8, review_above: 0.5 });
  });
});
