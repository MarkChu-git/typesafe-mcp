import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import * as z from "zod/v4";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export type ErrorCategory =
  | "AUTH"
  | "RATE_LIMIT"
  | "OVERLOADED"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_REQUEST"
  | "VALIDATION"
  | "UPSTREAM"
  | "CONFIG";

export interface ClassifiedError {
  category: ErrorCategory;
  hint: string;
  requestId?: string;
  detail?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractDetail = (body: unknown): string | undefined => {
  if (typeof body === "string") return body || undefined;
  if (!isRecord(body)) return undefined;
  const { error, message, detail } = body;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof message === "string") return message;
  if (typeof detail === "string") return detail;
  if (isRecord(detail) && typeof detail.message === "string") return detail.message;
  if (Array.isArray(detail)) {
    const parts = detail.flatMap((item) => {
      if (!isRecord(item) || typeof item.msg !== "string") return [];
      const loc = Array.isArray(item.loc) ? item.loc.filter((x) => x !== "body").join(".") : "";
      return [loc ? `${loc}: ${item.msg}` : item.msg];
    });
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  return undefined;
};

const formatZodIssues = (err: z.ZodError): string =>
  err.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  }).join("; ");

export function classify(err: unknown): ClassifiedError {
  if (err instanceof ConfigError) {
    return {
      category: "CONFIG",
      hint: "Set TYPESAFE_API_KEY in the MCP server env (Cursor mcp.json → env). Get a key at console.typesafe.ai.",
    };
  }
  if (err instanceof z.ZodError) {
    return {
      category: "VALIDATION",
      hint: formatZodIssues(err),
    };
  }
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    const classified: ClassifiedError = {
      category: "AUTH",
      hint: "TYPESAFE_API_KEY was rejected. Check the key and account status; run jev_models to verify.",
    };
    if (err.requestId) classified.requestId = err.requestId;
    const detail = extractDetail(err.body);
    if (detail) classified.detail = detail;
    return classified;
  }
  if (err instanceof UnprocessableEntityError || err instanceof BadRequestError) {
    const classified: ClassifiedError = {
      category: "INVALID_REQUEST",
      hint: "The API rejected the request body. Reduce state size if you hit token limits, and check question criteria.",
    };
    if (err.requestId) classified.requestId = err.requestId;
    const detail = extractDetail(err.body);
    if (detail) classified.detail = detail;
    return classified;
  }
  if (err instanceof RateLimitError) {
    const classified: ClassifiedError = {
      category: "RATE_LIMIT",
      hint: "Rate limited after retries. Wait a few seconds, or batch questions into one jev_ask call.",
    };
    if (err.requestId) classified.requestId = err.requestId;
    return classified;
  }
  if (err instanceof APIError && err.status === 529) {
    const classified: ClassifiedError = {
      category: "OVERLOADED",
      hint: "TypeSafe is temporarily overloaded. Retry shortly.",
    };
    if (err.requestId) classified.requestId = err.requestId;
    return classified;
  }
  if (err instanceof APITimeoutError) {
    return {
      category: "TIMEOUT",
      hint: "Request timed out after retries. Reduce state size or raise TYPESAFE_TIMEOUT_MS.",
    };
  }
  if (err instanceof APIConnectionError) {
    return {
      category: "NETWORK",
      hint: "Could not reach api.typesafe.ai. Check connectivity/proxy.",
    };
  }
  if (err instanceof APIError) {
    const classified: ClassifiedError = {
      category: "UPSTREAM",
      hint: `HTTP ${String(err.status)}`,
    };
    if (err.requestId) classified.requestId = err.requestId;
    const detail = extractDetail(err.body);
    if (detail) classified.detail = detail;
    return classified;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { category: "UPSTREAM", hint: message };
}

export function redact(text: string, secret: string | undefined = process.env.TYPESAFE_API_KEY): string {
  let out = text.replace(/Bearer\s+\S+/gi, "Bearer ***");
  const key = secret?.trim();
  if (!key) return out;
  out = out.split(key).join("***");
  if (key.length >= 5) {
    for (let n = key.length - 1; n >= 5; n -= 1) {
      const prefix = key.slice(0, n);
      if (out.includes(prefix)) out = out.split(prefix).join("***");
    }
  }
  return out;
}

export function toToolError(err: unknown, ctx: { tool: string }): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  const c = classify(err);
  const parts = [`${c.category}: ${c.hint}`];
  if (c.detail) parts.push(`Detail: ${c.detail}`);
  if (c.requestId) parts.push(`(request_id ${c.requestId})`);
  parts.push(`[tool ${ctx.tool}]`);
  const text = redact(parts.join(" "));
  console.error(`[typesafe-mcp] ${ctx.tool} ${c.category}${c.requestId ? ` ${c.requestId}` : ""}`);
  return { content: [{ type: "text", text }], isError: true };
}
