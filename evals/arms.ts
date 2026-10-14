import { join } from "node:path";
import { ARM_IDS, JEV_TOOLS, type Arm, type ArmId, type JevTool } from "./harness/types.ts";

export const JEV_SERVER = "jev";
export const BUILTIN_TOOLS = ["Read", "Grep", "Glob"] as const;
/** A coding environment: run, write and edit scripts. Bash runs in the sandbox from `armSettings`. */
export const CODE_TOOLS = ["Bash", "Edit", "Write"] as const;
/**
 * Every Bash command runs without a prompt, as in a session that bypasses permissions; the sandbox from
 * `armSettings` still confines what it writes and reaches. Without the rule, `dontAsk` denies the
 * commands the sandbox cannot vet up front, such as loops, awk programs and heredocs.
 */
export const CODE_PERMISSIONS = ["Bash", "Edit", "Write"] as const;
/** What learning the SDK takes: the TypeSafe docs and the TypeSafe skill. */
export const SDK_TOOLS = ["WebFetch", "Skill"] as const;
/** WebFetch reaches only the TypeSafe docs. */
export const SDK_PERMISSIONS = ["WebFetch(domain:docs.typesafe.ai)", "Skill"] as const;
/** A pinned copy of the official TypeSafe plugin (typesafe-ai/skills 0.5.7, MIT) that SDK arms load. */
export const SDK_PLUGIN_DIR = join(import.meta.dir, "vendor", "typesafe-plugin");
/** The one skill an SDK arm sees, so arms differ only in how they reach Jev. */
export const SDK_SKILL = "typesafe:typesafe-ai";
/**
 * Skills that outlive CLAUDE_CODE_DISABLE_BUNDLED_SKILLS in Claude Code 2.1.294, turned off by name. A
 * newer CLI that adds one fails the skill check at `system/init` instead of skewing the comparison.
 */
export const SKILL_OVERRIDES = { design: "off", doctor: "off", "plugin-authoring": "off" };
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** Tag of the last published release, run side by side with the working tree to measure changes. */
export const RELEASED_REF = "v0.1.1";

export const DIRECTED_PROMPT =
  "For every classification, scoring or yes/no judgment in this task, call the jev tools instead of judging it yourself.";
/** A line a user could put in CLAUDE.md or AGENTS.md: the user's own rule, which agents follow where the server's instructions only advise. */
export const HOUSE_RULE_PROMPT =
  "When a task needs a judgment about several files or records, ask Jev with jev_ask before reading them yourself, even if there are only a few: which files a bug or change involves, whether changed files follow the conventions, why each failed test failed, which log entries belong to an incident, or classifying and ranking items. Read only what Jev is unsure about. Use grep or code for exact lookups, such as a symbol's callers.";
/** What an SDK arm is told about its setup, the counterpart of an MCP arm seeing the jev tool. */
export const SDK_NOTE =
  "The TypeSafe JavaScript SDK (@typesafe-ai/sdk) is installed in this directory and TYPESAFE_API_KEY is set; run scripts with bun.";
export const SDK_DIRECTED_PROMPT =
  "For every classification, scoring or yes/no judgment in this task, call Jev through the TypeSafe SDK instead of judging it yourself.";

export const ARMS: Record<ArmId, Arm> = {
  baseline: { id: "baseline", jev: false },
  jev: { id: "jev", jev: { allow: ["jev_ask"] } },
  "jev-directed": { id: "jev-directed", jev: { allow: ["jev_ask"] }, extraPrompt: DIRECTED_PROMPT },
  "jev-all": { id: "jev-all", jev: { allow: JEV_TOOLS, env: { TYPESAFE_TOOLS: "all" } } },
  "jev-v0.1.1": { id: "jev-v0.1.1", jev: { allow: JEV_TOOLS, ref: RELEASED_REF } },
  "jev-directed-code": { id: "jev-directed-code", jev: { allow: ["jev_ask"] }, code: true, extraPrompt: DIRECTED_PROMPT },
  "jev-code": { id: "jev-code", jev: { allow: ["jev_ask"] }, code: true },
  "jev-code-deferred": { id: "jev-code-deferred", jev: { allow: ["jev_ask"] }, code: true, deferred: true },
  "jev-code-rule": { id: "jev-code-rule", jev: { allow: ["jev_ask"] }, code: true, extraPrompt: HOUSE_RULE_PROMPT },
  "jev-code-deferred-rule": {
    id: "jev-code-deferred-rule",
    jev: { allow: ["jev_ask"] },
    code: true,
    deferred: true,
    extraPrompt: HOUSE_RULE_PROMPT,
  },
  sdk: { id: "sdk", jev: false, code: true, sdk: true, extraPrompt: SDK_NOTE },
  "sdk-directed": {
    id: "sdk-directed",
    jev: false,
    code: true,
    sdk: true,
    extraPrompt: `${SDK_NOTE} ${SDK_DIRECTED_PROMPT}`,
  },
};

/** Arms run when `--arms` is not given: no jev, the working tree, and the last release. */
export const DEFAULT_ARMS: readonly ArmId[] = ["baseline", "jev", "jev-v0.1.1"];

export const isArmId = (id: string): id is ArmId => (ARM_IDS as readonly string[]).includes(id);

export const mcpToolName = (tool: JevTool): string => `mcp__${JEV_SERVER}__${tool}`;

/** The built-in tools an arm gets, as `--tools` lists them. */
export function builtinTools(arm: Arm): string[] {
  return [
    ...BUILTIN_TOOLS,
    ...(arm.code ? CODE_TOOLS : []),
    ...(arm.sdk ? SDK_TOOLS : []),
    ...(arm.deferred ? ["ToolSearch"] : []),
  ];
}

/** Every tool the agent must see at `system/init`, sorted. A mismatch makes the run `invalid`. */
export function expectedTools(arm: Arm): string[] {
  const jev = arm.jev ? arm.jev.allow.map(mcpToolName) : [];
  return [...builtinTools(arm), STRUCTURED_OUTPUT_TOOL, ...jev].toSorted();
}

/** Every skill the agent must see at `system/init`. A mismatch makes the run `invalid`. */
export function expectedSkills(arm: Arm): string[] {
  return arm.sdk ? [SDK_SKILL] : [];
}

/** Permission rules for `--allowedTools`; `--permission-mode dontAsk` denies any other call that needs one. */
export function allowedTools(arm: Arm): string[] {
  return [
    ...(arm.jev ? [`mcp__${JEV_SERVER}`] : []),
    ...(arm.code ? CODE_PERMISSIONS : []),
    ...(arm.sdk ? SDK_PERMISSIONS : []),
  ];
}

/**
 * `--settings` for an arm, or null when it needs none.
 * - SDK arms turn off every skill but TypeSafe's: SKILL_OVERRIDES here, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS in the env.
 * - Code arms run Bash in the sandbox. Any command runs without a prompt, but writes stay inside the
 *   workspace, and the network reaches only the TypeSafe API, for SDK arms, plus the domains WebFetch
 *   rules allow. Without a sandbox the run fails rather than running commands unconfined.
 */
export function armSettings(arm: Arm): Record<string, unknown> | null {
  const settings: Record<string, unknown> = {};
  if (arm.sdk) settings.skillOverrides = SKILL_OVERRIDES;
  if (arm.code) {
    settings.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      failIfUnavailable: true,
      network: { allowedDomains: arm.sdk ? ["api.typesafe.ai"] : [] },
    };
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

/** jev tools hidden from the agent via `--disallowedTools`, in case the server exposes more than allowed. */
export function disallowedTools(arm: Arm): string[] {
  if (!arm.jev) return [];
  const allow = new Set<JevTool>(arm.jev.allow);
  return JEV_TOOLS.filter((t) => !allow.has(t)).map(mcpToolName);
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/**
 * The jev server for an arm: the working tree's `src/index.ts`, or for a `ref` arm the entry file
 * that `prepareRefServer` unpacked (`refEntry`).
 */
export function mcpConfig(arm: Arm, repoRoot: string, refEntry?: string): McpConfig {
  if (!arm.jev) return { mcpServers: {} };
  if (arm.jev.ref && !refEntry) throw new Error(`${arm.id}: ${arm.jev.ref} is not unpacked`);
  const entry = arm.jev.ref ? (refEntry ?? "") : join(repoRoot, "src", "index.ts");
  const server: McpServerEntry = { command: "bun", args: ["run", entry] };
  if (arm.jev.env) server.env = { ...arm.jev.env };
  return { mcpServers: { [JEV_SERVER]: server } };
}
