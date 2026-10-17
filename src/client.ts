import { TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import { readConfig, type RuntimeConfig } from "./config.ts";
import { ConfigError } from "./errors.ts";

export interface ClientDeps {
  fetch?: Fetch;
  env?: Record<string, string | undefined>;
  /** Where `files` reads when the host shares no MCP roots; the process's working directory by default. */
  cwd?: string;
}

let cached: TypeSafeClient | undefined;

const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

/**
 * SDK 0.7.0 takes a reader on each response body and releases it before reading the body, which Bun
 * treats as using the body up ("Body already used", typesafe-ai/typesafe-sdk-js#20). Bun reads a body
 * streamed from JavaScript correctly, so each response is buffered and streamed again.
 */
const restreamed = (fetch: Fetch): Fetch => async (input, init) => {
  const res = await fetch(input, init);
  if (res.body === null) return res;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
};

export function getClient(deps: ClientDeps = {}): TypeSafeClient {
  if (cached) return cached;
  const cfg: RuntimeConfig = readConfig(deps.env);
  if (!cfg.apiKey) {
    throw new ConfigError(
      "TYPESAFE_API_KEY is not set. Add it to the MCP server env in your host config (stdio spawn env). Get a key at https://console.typesafe.ai",
    );
  }
  cached = new TypeSafeClient({
    apiKey: cfg.apiKey,
    defaultModel: cfg.defaultModel,
    timeout: cfg.timeoutMs,
    fetch: restreamed(deps.fetch ?? defaultFetch),
    logLevel: "warn",
  });
  return cached;
}

/** Test helper: drop the cached client so the next `getClient` rebuilds. */
export function resetClient(): void {
  cached = undefined;
}
