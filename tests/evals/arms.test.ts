import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  allowedTools,
  ARMS,
  armSettings,
  DEFAULT_ARMS,
  disallowedTools,
  expectedSkills,
  expectedTools,
  HOUSE_RULE_PROMPT,
  mcpConfig,
  RELEASED_REF,
  SDK_DIRECTED_PROMPT,
  SDK_NOTE,
  SDK_PERMISSIONS,
  SDK_PLUGIN_DIR,
  SDK_SKILL,
} from "../../evals/arms.ts";

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

  test("a task's server env reaches every jev server under the arm's own env, and no server appears for it", () => {
    const entry = join("/repo", "src", "index.ts");
    expect(mcpConfig(ARMS.jev, "/repo", undefined, { TYPESAFE_IMAGES: "1" })).toEqual({
      mcpServers: { jev: { command: "bun", args: ["run", entry], env: { TYPESAFE_IMAGES: "1" } } },
    });
    expect(mcpConfig(ARMS["jev-all"], "/repo", undefined, { TYPESAFE_IMAGES: "1", TYPESAFE_TOOLS: "ask" })).toEqual({
      mcpServers: { jev: { command: "bun", args: ["run", entry], env: { TYPESAFE_IMAGES: "1", TYPESAFE_TOOLS: "all" } } },
    });
    expect(mcpConfig(ARMS.baseline, "/repo", undefined, { TYPESAFE_IMAGES: "1" })).toEqual({ mcpServers: {} });
  });

  test("the release arm runs the unpacked release and refuses to start without it", () => {
    expect(ARMS["jev-v0.1.1"].jev).toMatchObject({ ref: RELEASED_REF });
    expect(mcpConfig(ARMS["jev-v0.1.1"], "/repo", "/servers/v0.1.1/src/index.ts")).toEqual({
      mcpServers: { jev: { command: "bun", args: ["run", "/servers/v0.1.1/src/index.ts"] } },
    });
    expect(() => mcpConfig(ARMS["jev-v0.1.1"], "/repo")).toThrow("not unpacked");
  });

  test("of the MCP arms only the directed one adds a prompt line; the default compares no jev, now and the release", () => {
    expect(ARMS["jev-directed"].extraPrompt).toBeString();
    expect(ARMS.jev.extraPrompt).toBeUndefined();
    expect(DEFAULT_ARMS).toEqual(["baseline", "jev", "jev-v0.1.1"]);
  });

  test("SDK arms run scripts and load the TypeSafe skill instead of an MCP server", () => {
    for (const id of ["sdk", "sdk-directed"] as const) {
      expect(mcpConfig(ARMS[id], "/repo")).toEqual({ mcpServers: {} });
      expect(expectedTools(ARMS[id])).toEqual([
        "Bash",
        "Edit",
        "Glob",
        "Grep",
        "Read",
        "Skill",
        "StructuredOutput",
        "WebFetch",
        "Write",
      ]);
      expect(allowedTools(ARMS[id])).toEqual(["Bash", "Edit", "Write", ...SDK_PERMISSIONS]);
      expect(armSettings(ARMS[id])).toMatchObject({ sandbox: { network: { allowedDomains: ["api.typesafe.ai"] } } });
      expect(expectedSkills(ARMS[id])).toEqual([SDK_SKILL]);
      expect(ARMS[id].extraPrompt).toStartWith(SDK_NOTE);
    }
    expect(expectedSkills(ARMS["jev-directed"])).toEqual([]);
    expect(ARMS.sdk.extraPrompt).toBe(SDK_NOTE);
    expect(ARMS["sdk-directed"].extraPrompt).toEndWith(SDK_DIRECTED_PROMPT);
    expect(allowedTools(ARMS.jev)).toEqual(["mcp__jev"]);
    expect(allowedTools(ARMS.baseline)).toEqual([]);
    expect(existsSync(join(SDK_PLUGIN_DIR, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(SDK_PLUGIN_DIR, "skills", "typesafe-ai", "SKILL.md"))).toBe(true);
  });

  test("the deferred arm mirrors a session with many MCP servers: coding tools, and jev_ask behind ToolSearch", () => {
    const arm = ARMS["jev-code-deferred"];
    expect(expectedTools(arm)).toEqual([
      "Bash",
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "StructuredOutput",
      "ToolSearch",
      "Write",
      "mcp__jev__jev_ask",
    ]);
    expect(arm.extraPrompt).toBeUndefined();
    expect(allowedTools(arm)).toEqual(["mcp__jev", "Bash", "Edit", "Write"]);
  });

  test("jev-code is a session with only this MCP server: jev_ask loads up front next to the coding tools, and nothing tells the agent to use it", () => {
    const arm = ARMS["jev-code"];
    expect(expectedTools(arm)).toEqual([
      "Bash",
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "StructuredOutput",
      "Write",
      "mcp__jev__jev_ask",
    ]);
    expect(arm.deferred).toBeUndefined();
    expect(arm.extraPrompt).toBeUndefined();
    expect(allowedTools(arm)).toEqual(["mcp__jev", "Bash", "Edit", "Write"]);
    expect(armSettings(arm)).toMatchObject({ sandbox: { enabled: true, network: { allowedDomains: [] } } });
  });

  test("the rule arms are jev-code and jev-code-deferred plus one line a user wrote in CLAUDE.md or AGENTS.md", () => {
    const pairs = [
      ["jev-code-rule", "jev-code"],
      ["jev-code-deferred-rule", "jev-code-deferred"],
    ] as const;
    for (const [id, base] of pairs) {
      const arm = ARMS[id];
      expect(expectedTools(arm)).toEqual(expectedTools(ARMS[base]));
      expect(allowedTools(arm)).toEqual(allowedTools(ARMS[base]));
      expect(arm.deferred).toBe(ARMS[base].deferred);
      expect(arm.extraPrompt).toBe(HOUSE_RULE_PROMPT);
    }
  });

  test("the code arm has the SDK arms' coding tools and sandbox but reaches Jev over MCP", () => {
    const arm = ARMS["jev-directed-code"];
    expect(expectedTools(arm)).toEqual([
      "Bash",
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "StructuredOutput",
      "Write",
      "mcp__jev__jev_ask",
    ]);
    expect(expectedSkills(arm)).toEqual([]);
    expect(allowedTools(arm)).toEqual(["mcp__jev", "Bash", "Edit", "Write"]);
    expect(armSettings(arm)).toMatchObject({ sandbox: { enabled: true, network: { allowedDomains: [] } } });
    expect(arm.extraPrompt).toBe(ARMS["jev-directed"].extraPrompt);
    expect(armSettings(ARMS.baseline)).toBeNull();
  });
});
