import type { Usage } from "@typesafe-ai/sdk";
import type { Thresholds } from "./gating.ts";

/** `_meta` key for request details the agent does not need; hosts keep `_meta` out of the model's context. */
export const META_KEY = "typesafe.ai/jev";

export type JevMeta = {
  model: string;
  usage: Usage;
  thresholds?: Thresholds;
};

// A type alias, not an interface: the SDK's result type has an index signature.
export type OkResult<T> = {
  content: [{ type: "text"; text: string }];
  structuredContent: T;
  _meta?: { [META_KEY]: JevMeta };
};

export function ok<T>(structured: T, meta?: JevMeta): OkResult<T> {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
    ...(meta ? { _meta: { [META_KEY]: meta } } : {}),
  };
}
