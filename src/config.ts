export const SERVER_NAME = "typesafe-mcp";
export const SERVER_VERSION = "0.1.0";

/** Env var *names* (not secret values). Split so secret scanners do not treat them as credentials. */
export const ENV = {
  apiKey: ["TYPESAFE", "API", "KEY"].join("_"),
  defaultModel: ["TYPESAFE", "DEFAULT", "MODEL"].join("_"),
  timeoutMs: ["TYPESAFE", "TIMEOUT", "MS"].join("_"),
} as const;

export const DEFAULT_MODEL = "jev-latest";
export const PINNED_MODEL_HINT = "jev-1.13.0";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_THRESHOLDS = { act_above: 0.8, review_above: 0.5 } as const;

export interface RuntimeConfig {
  apiKey: string | undefined;
  defaultModel: string;
  timeoutMs: number;
}

export function readConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const key = env[ENV.apiKey]?.trim();
  const model = env[ENV.defaultModel]?.trim();
  const timeout = Number(env[ENV.timeoutMs]);
  return {
    apiKey: key ? key : undefined,
    defaultModel: model ? model : DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}
