import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MODEL,
  DEFAULT_THRESHOLDS,
  DEFAULT_TIMEOUT_MS,
  parseTools,
  readConfig,
  TOOL_NAMES,
} from "../src/config.ts";

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

  test("exposes only jev_ask unless TYPESAFE_TOOLS says otherwise", () => {
    expect(readConfig({}).tools).toEqual(["jev_ask"]);
    expect(readConfig({ TYPESAFE_TOOLS: "all" }).tools).toEqual([...TOOL_NAMES]);
  });
});

describe("parseTools", () => {
  test("accepts short and full names, keeps registration order", () => {
    expect(parseTools("models,ask")).toEqual({ tools: ["jev_ask", "jev_models"], unknownTools: [] });
    expect(parseTools(" jev_score  jev_check ")).toEqual({ tools: ["jev_check", "jev_score"], unknownTools: [] });
  });

  test("reports unknown names and falls back to the default when nothing is left", () => {
    expect(parseTools("check, bogus")).toEqual({ tools: ["jev_check"], unknownTools: ["bogus"] });
    expect(parseTools("bogus")).toEqual({ tools: ["jev_ask"], unknownTools: ["bogus"] });
    expect(parseTools("")).toEqual({ tools: ["jev_ask"], unknownTools: [] });
  });

  test("is case-insensitive", () => {
    expect(parseTools("ALL").tools).toEqual([...TOOL_NAMES]);
  });
});
