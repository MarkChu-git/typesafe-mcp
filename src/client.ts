import { TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import { readConfig, type RuntimeConfig } from "./config.ts";
import { ConfigError } from "./errors.ts";

export interface ClientDeps {
  fetch?: Fetch;
  env?: Record<string, string | undefined>;
}

let cached: TypeSafeClient | undefined;

const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

export function getClient(deps: ClientDeps = {}): TypeSafeClient {
  if (cached) return cached;
  const cfg: RuntimeConfig = readConfig(deps.env);
  if (!cfg.apiKey) {
    throw new ConfigError(
      "TYPESAFE_API_KEY is not set. Add it to the MCP server \"env\" in your Cursor mcp.json. Get a key at https://console.typesafe.ai",
    );
  }
  cached = new TypeSafeClient({
    apiKey: cfg.apiKey,
    defaultModel: cfg.defaultModel,
    timeout: cfg.timeoutMs,
    fetch: deps.fetch ?? defaultFetch,
    logLevel: "warn",
  });
  return cached;
}

/** Test helper: drop the cached client so the next `getClient` rebuilds. */
export function resetClient(): void {
  cached = undefined;
}
