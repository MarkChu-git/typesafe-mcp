type Level = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;
type LogArgs = [message: string, fields?: LogFields] | [fields: LogFields, message?: string];

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function parseLevel(value: string | undefined): Level {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

let threshold = parseLevel(process.env.LOG_LEVEL);

export function setLogLevel(level: Level): void {
  threshold = level;
}

function replacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}

function emit(level: Level, ...args: LogArgs): void {
  if (RANK[level] < RANK[threshold]) return;
  const [first, second] = args;
  const fields = typeof first === "string" ? second : first;
  const message = typeof first === "string" ? first : second;
  const entry = {
    level,
    message,
    ...(typeof fields === "object" ? fields : undefined),
    at: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(entry, replacer)}\n`);
}

export const logger = {
  debug: (...args: LogArgs): void => emit("debug", ...args),
  info: (...args: LogArgs): void => emit("info", ...args),
  warn: (...args: LogArgs): void => emit("warn", ...args),
  error: (...args: LogArgs): void => emit("error", ...args),
};
