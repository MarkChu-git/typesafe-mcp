import { basename } from "node:path";
import { META_KEY } from "../../src/result.ts";
import type { QuotaInfo, RunMetrics, RunStatus, StreamLine, TokenUsage, ToolCallRecord } from "./types.ts";

type Json = Record<string, unknown>;

export interface ParseContext {
  expectedTools: readonly string[];
  /** Skills the agent must see at `system/init`; none when absent. */
  expectedSkills?: readonly string[];
  timedOut: boolean;
  exitCode: number | null;
}

const ALLOWED_QUOTA = new Set(["allowed", "allowed_warning"]);
const JEV_PREFIX = "mcp__jev__";
/**
 * Code that calls Jev: an import of the TypeSafe SDK or a request to its HTTP API. A path or a note that
 * names the package, as in `ls node_modules/@typesafe-ai/sdk`, is reading about it, not calling it.
 */
const SDK_CALL = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']@typesafe-ai\/sdk["']|https?:\/\/api\.typesafe\.ai\b/;
/** Files a shell command writes, as in `cat > judge.ts <<'EOF'` or `tee judge.ts`. */
const WRITTEN = /(?:>{1,2}|\btee(?:\s+-a)?)\s*([^\s;&|<>()]+)/g;
const SCRIPT_FILE = /\.[cm]?[jt]s$/;
const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Whether `command` starts `script` with a runner, so editing, reading or naming the script does not count. */
function runs(command: string, script: string): boolean {
  const runner = String.raw`(?:bun(?:\s+run)?|node|tsx|npx\s+tsx|deno\s+run)`;
  return new RegExp(String.raw`(?:^|[\s;&|(])${runner}\s+(?:\S*/)?${escapeRegExp(script)}(?=$|[\s;&|)])`).test(command);
}

/** The code a Write or Edit call puts in a file, or null for any other call. */
function codeWritten(name: string, input: Json): string | null {
  if (name === "Write") return str(input.content) ?? "";
  if (name === "Edit") return str(input.new_string) ?? "";
  return null;
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return list(content)
    .map((b) => (isObj(b) && b.type === "text" ? (str(b.text) ?? "") : ""))
    .join("");
}

/**
 * Jev input tokens for one jev tool result. The current server reports them in `_meta`, which Claude
 * Code keeps out of the model's context but copies into the event's `tool_use_result`; v0.1.x put
 * `usage` in the result JSON itself.
 */
function jevInputTokens(toolUseResult: unknown, text: string): number | null {
  const meta = isObj(toolUseResult) && isObj(toolUseResult._meta) ? toolUseResult._meta[META_KEY] : undefined;
  if (isObj(meta) && isObj(meta.usage)) return numOrNull(meta.usage.input_tokens);
  try {
    const parsed: unknown = JSON.parse(text);
    return isObj(parsed) && isObj(parsed.usage) ? numOrNull(parsed.usage.input_tokens) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a call is part of using Jev: a jev MCP call; writing code that calls Jev with Write, Edit or a
 * shell redirect (the file is remembered in `scripts` by name); or a Bash command that calls Jev inline
 * or runs one of those scripts.
 */
function usesJev(name: string, input: unknown, scripts: Set<string>): boolean {
  if (name.startsWith(JEV_PREFIX)) return true;
  if (!isObj(input)) return false;
  const code = codeWritten(name, input);
  if (code !== null) {
    if (!SDK_CALL.test(code)) return false;
    const path = str(input.file_path);
    if (path) scripts.add(basename(path));
    return true;
  }
  if (name !== "Bash") return false;
  const command = str(input.command) ?? "";
  if (SDK_CALL.test(command)) {
    for (const [, target = ""] of command.matchAll(WRITTEN)) if (SCRIPT_FILE.test(target)) scripts.add(basename(target));
    return true;
  }
  return [...scripts].some((script) => runs(command, script));
}

function toQuota(info: unknown): QuotaInfo | null {
  if (!isObj(info)) return null;
  const windows = isObj(info.unifiedWindows) ? info.unifiedWindows : {};
  const util = (w: unknown) => (isObj(w) ? numOrNull(w.utilization) : null);
  return {
    status: str(info.status) ?? "unknown",
    fiveHourUtilization: util(windows.five_hour),
    sevenDayUtilization: util(windows.seven_day),
    resetsAt: numOrNull(info.resetsAt),
  };
}

function usageByModel(result: Json | null): Record<string, TokenUsage> {
  const out: Record<string, TokenUsage> = {};
  if (!result || !isObj(result.modelUsage)) return out;
  for (const [model, u] of Object.entries(result.modelUsage)) {
    if (!isObj(u)) continue;
    out[model] = {
      input: num(u.inputTokens),
      output: num(u.outputTokens),
      cacheWrite: num(u.cacheCreationInputTokens),
      cacheRead: num(u.cacheReadInputTokens),
    };
  }
  return out;
}

/** Why the sorted `got` differs from `expected`, or null when they match. */
function listMismatch(what: string, got: readonly string[], expected: readonly string[]): string | null {
  const want = expected.toSorted();
  if (got.length === want.length && got.every((t, i) => t === want[i])) return null;
  return `${what} list mismatch: expected [${want.join(", ")}], got [${got.join(", ")}]`;
}

function invalidReason(init: Json | null, tools: readonly string[], ctx: ParseContext): string | null {
  if (!init) return "no init event";
  const skills = list(init.skills)
    .filter((s): s is string => typeof s === "string")
    .toSorted();
  const mismatch =
    listMismatch("tool", tools, ctx.expectedTools) ?? listMismatch("skill", skills, ctx.expectedSkills ?? []);
  if (mismatch) return mismatch;
  const down = list(init.mcp_servers).filter((s) => isObj(s) && s.status !== "connected");
  if (down.length > 0) return `MCP server not connected: ${JSON.stringify(down)}`;
  return null;
}

function statusOf(
  invalid: string | null,
  result: Json | null,
  quota: QuotaInfo | null,
  ctx: ParseContext,
): RunStatus {
  if (invalid) return "invalid";
  if (ctx.timedOut) return "timeout";
  if ((quota && !ALLOWED_QUOTA.has(quota.status)) || result?.api_error_status === 429) return "rate_limited";
  if (!result) return "error";
  if (result.subtype === "error_max_turns" || result.terminal_reason === "max_turns") return "max_turns";
  if (result.subtype === "error_max_budget_usd" || result.terminal_reason === "budget_exhausted") {
    return "budget_exceeded";
  }
  if (result.is_error === true) return "error";
  return result.structured_output == null ? "no_answer" : "answered";
}

function errorMessage(status: RunStatus, invalid: string | null, result: Json | null, ctx: ParseContext): string | null {
  if (invalid) return invalid;
  if (status === "timeout") return "timed out";
  if (!result) return ctx.exitCode === null ? "no result event" : `no result event (exit ${ctx.exitCode})`;
  if (result.is_error !== true) return null;
  const errors = list(result.errors).filter((e): e is string => typeof e === "string");
  return errors.length > 0 ? errors.join("; ") : (str(result.result) ?? "unknown error");
}

/** Turns one run's `stream-json` output into metrics. Usage totals come from `result.modelUsage`. */
export function parseRun(lines: readonly StreamLine[], ctx: ParseContext): RunMetrics {
  let init: Json | null = null;
  let result: Json | null = null;
  let quota: QuotaInfo | null = null;
  let firstTurnContextTokens: number | null = null;
  let firstJevContextTokens: number | null = null;
  const contextByMessage = new Map<string, number>();
  const calls = new Map<string, ToolCallRecord>();
  const startedAt = new Map<string, number>();
  const sdkScripts = new Set<string>();

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line.raw);
    } catch {
      continue;
    }
    if (!isObj(event)) continue;

    if (event.type === "system" && event.subtype === "init") init = event;
    else if (event.type === "rate_limit_event") quota = toQuota(event.rate_limit_info) ?? quota;
    else if (event.type === "result") result = event;
    else if (event.type === "assistant" && isObj(event.message)) {
      const message = event.message;
      let context: number | null = null;
      if (message.model !== "<synthetic>" && isObj(message.usage)) {
        const u = message.usage;
        context = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
        firstTurnContextTokens ??= context;
        const id = str(message.id) ?? `#${contextByMessage.size}`;
        if (!contextByMessage.has(id)) contextByMessage.set(id, context);
      }
      for (const block of list(message.content)) {
        if (!isObj(block) || block.type !== "tool_use") continue;
        const id = str(block.id);
        const name = str(block.name);
        if (!id || !name || calls.has(id)) continue;
        const jev = usesJev(name, block.input, sdkScripts);
        if (jev) firstJevContextTokens ??= context;
        calls.set(id, {
          name,
          argChars: JSON.stringify(block.input ?? {}).length,
          resultChars: 0,
          isError: false,
          latencyMs: null,
          jevInputTokens: null,
          jev,
        });
        startedAt.set(id, line.receivedAt);
      }
    } else if (event.type === "user" && isObj(event.message)) {
      const results = list(event.message.content).filter((b) => isObj(b) && b.type === "tool_result");
      // `tool_use_result` belongs to the event, so it is only attributable when there is one result.
      const toolUseResult = results.length === 1 ? event.tool_use_result : undefined;
      for (const block of results) {
        if (!isObj(block)) continue;
        const id = str(block.tool_use_id);
        const call = id ? calls.get(id) : undefined;
        if (!id || !call) continue;
        const text = resultText(block.content);
        const t0 = startedAt.get(id);
        call.resultChars = text.length;
        call.isError = block.is_error === true;
        call.latencyMs = t0 === undefined ? null : line.receivedAt - t0;
        if (call.name.startsWith(JEV_PREFIX)) call.jevInputTokens = jevInputTokens(toolUseResult, text);
      }
    }
  }

  const tools = list(init?.tools)
    .filter((t): t is string => typeof t === "string")
    .toSorted();
  const invalid = invalidReason(init, tools, ctx);
  const status = statusOf(invalid, result, quota, ctx);
  const byModel = usageByModel(result);
  const toolCalls = [...calls.values()];
  const first = lines[0]?.receivedAt ?? 0;
  const last = lines.at(-1)?.receivedAt ?? first;

  return {
    status,
    model: str(init?.model),
    cliVersion: str(init?.claude_code_version),
    tools,
    turns: num(result?.num_turns),
    durationMs: numOrNull(result?.duration_ms) ?? last - first,
    costUsd: num(result?.total_cost_usd),
    usageByModel: byModel,
    totalTokens: Object.values(byModel).reduce((s, u) => s + u.input + u.output + u.cacheWrite + u.cacheRead, 0),
    toolCalls,
    toolErrors: toolCalls.filter((c) => c.isError).length,
    jevTokens: toolCalls.reduce((s, c) => s + (c.jevInputTokens ?? 0), 0),
    firstTurnContextTokens,
    peakContextTokens: contextByMessage.size === 0 ? null : Math.max(...contextByMessage.values()),
    firstJevContextTokens,
    modelCalls: contextByMessage.size,
    structuredOutput: result?.structured_output ?? null,
    terminalReason: str(result?.terminal_reason),
    quota,
    errorMessage: errorMessage(status, invalid, result, ctx),
  };
}
