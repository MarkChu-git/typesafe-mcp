import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ARMS, DEFAULT_ARMS, disallowedTools, expectedTools, mcpConfig, RELEASED_REF } from "../../evals/arms.ts";

describe("eval arms", () => {
  test("the jev arm sees only jev_ask, as the server exposes by default", () => {
    expect(expectedTools(ARMS.jev)).toEqual(["Glob", "Grep", "Read", "StructuredOutput", "mcp__jev__jev_ask"]);
    expect(disallowedTools(ARMS.jev)).toEqual([
      "mcp__jev__jev_check",
      "mcp__jev__jev_classify",
      "mcp__jev__jev_score",
      "mcp__jev__jev_models",
    ]);
  });

  test("baseline has no MCP server and only builtin tools", () => {
    expect(mcpConfig(ARMS.baseline, "/repo")).toEqual({ mcpServers: {} });
    expect(disallowedTools(ARMS.baseline)).toEqual([]);
    expect(expectedTools(ARMS.baseline)).toEqual(["Glob", "Grep", "Read", "StructuredOutput"]);
  });

  test("working-tree arms run src/index.ts; jev-all turns every tool on through the server env", () => {
    expect(mcpConfig(ARMS.jev, "/repo")).toEqual({
      mcpServers: { jev: { command: "bun", args: ["run", join("/repo", "src", "index.ts")] } },
    });
    expect(mcpConfig(ARMS["jev-all"], "/repo")).toEqual({
      mcpServers: { jev: { command: "bun", args: ["run", join("/repo", "src", "index.ts")], env: { TYPESAFE_TOOLS: "all" } } },
    });
    expect(expectedTools(ARMS["jev-all"])).toHaveLength(9);
  });

  test("the release arm runs the unpacked release and refuses to start without it", () => {
    expect(ARMS["jev-v0.1.1"].jev).toMatchObject({ ref: RELEASED_REF });
    expect(mcpConfig(ARMS["jev-v0.1.1"], "/repo", "/servers/v0.1.1/src/index.ts")).toEqual({
      mcpServers: { jev: { command: "bun", args: ["run", "/servers/v0.1.1/src/index.ts"] } },
    });
    expect(() => mcpConfig(ARMS["jev-v0.1.1"], "/repo")).toThrow("not unpacked");
  });

  test("only the directed arm adds a prompt line; the default compares no jev, now and the release", () => {
    expect(ARMS["jev-directed"].extraPrompt).toBeString();
    expect(ARMS.jev.extraPrompt).toBeUndefined();
    expect(DEFAULT_ARMS).toEqual(["baseline", "jev", "jev-v0.1.1"]);
  });
});
