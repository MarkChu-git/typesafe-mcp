import { join } from "node:path";
import { ARM_IDS, JEV_TOOLS, type Arm, type ArmId, type JevTool } from "./harness/types.ts";

export const JEV_SERVER = "jev";
export const BUILTIN_TOOLS = ["Read", "Grep", "Glob"] as const;
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** Tag of the last published release, run side by side with the working tree to measure changes. */
export const RELEASED_REF = "v0.1.1";

export const DIRECTED_PROMPT =
  "For every classification, scoring or yes/no judgment in this task, call the jev tools instead of judging it yourself.";

export const ARMS: Record<ArmId, Arm> = {
  baseline: { id: "baseline", jev: false },
  jev: { id: "jev", jev: { allow: ["jev_ask"] } },
  "jev-directed": { id: "jev-directed", jev: { allow: ["jev_ask"] }, extraPrompt: DIRECTED_PROMPT },
  "jev-all": { id: "jev-all", jev: { allow: JEV_TOOLS, env: { TYPESAFE_TOOLS: "all" } } },
  "jev-v0.1.1": { id: "jev-v0.1.1", jev: { allow: JEV_TOOLS, ref: RELEASED_REF } },
};

/** Arms run when `--arms` is not given: no jev, the working tree, and the last release. */
export const DEFAULT_ARMS: readonly ArmId[] = ["baseline", "jev", "jev-v0.1.1"];

export const isArmId = (id: string): id is ArmId => (ARM_IDS as readonly string[]).includes(id);

export const mcpToolName = (tool: JevTool): string => `mcp__${JEV_SERVER}__${tool}`;

/** Every tool the agent must see at `system/init`, sorted. A mismatch makes the run `invalid`. */
export function expectedTools(arm: Arm): string[] {
  const jev = arm.jev ? arm.jev.allow.map(mcpToolName) : [];
  return [...BUILTIN_TOOLS, STRUCTURED_OUTPUT_TOOL, ...jev].toSorted();
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
