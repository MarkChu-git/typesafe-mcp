export const SERVER_NAME = "typesafe-mcp";
export const SERVER_VERSION = "0.1.0";

/** Env var *names* (not secret values). Split so secret scanners do not treat them as credentials. */
export const ENV = {
  apiKey: ["TYPESAFE", "API", "KEY"].join("_"),
  defaultModel: ["TYPESAFE", "DEFAULT", "MODEL"].join("_"),
  timeoutMs: ["TYPESAFE", "TIMEOUT", "MS"].join("_"),
  tools: ["TYPESAFE", "TOOLS"].join("_"),
  filesRoot: ["TYPESAFE", "FILES", "ROOT"].join("_"),
} as const;

export const DEFAULT_MODEL = "jev-latest";
export const PINNED_MODEL_HINT = "jev-1.13.0";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_THRESHOLDS = { act_above: 0.8, review_above: 0.5 } as const;

/** Every tool this server can expose, in registration order. */
export const TOOL_NAMES = ["jev_ask", "jev_check", "jev_classify", "jev_score", "jev_models"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Exposed when `TYPESAFE_TOOLS` is unset. `jev_ask` covers every question type, and each extra tool
 * definition costs the agent context on every model call.
 */
export const DEFAULT_TOOLS: readonly ToolName[] = ["jev_ask"];

export interface RuntimeConfig {
  apiKey: string | undefined;
  defaultModel: string;
  timeoutMs: number;
  tools: ToolName[];
  /** Entries of `TYPESAFE_TOOLS` that name no tool. */
  unknownTools: string[];
}

const toolName = (entry: string): ToolName | undefined =>
  TOOL_NAMES.find((t) => t === entry || t === `jev_${entry}`);

/** `TYPESAFE_TOOLS`: `all`, or a comma/space separated list such as `ask,models` or `jev_check`. */
export function parseTools(raw: string | undefined): { tools: ToolName[]; unknownTools: string[] } {
  const entries = (raw ?? "")
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const unknownTools = entries.filter((e) => e !== "all" && !toolName(e));
  if (entries.includes("all")) return { tools: [...TOOL_NAMES], unknownTools };
  const picked = new Set(entries.map(toolName));
  const tools = TOOL_NAMES.filter((t) => picked.has(t));
  return { tools: tools.length > 0 ? tools : [...DEFAULT_TOOLS], unknownTools };
}

export function readConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const key = env[ENV.apiKey]?.trim();
  const model = env[ENV.defaultModel]?.trim();
  const timeout = Number(env[ENV.timeoutMs]);
  return {
    apiKey: key ? key : undefined,
    defaultModel: model ? model : DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    ...parseTools(env[ENV.tools]),
  };
}
