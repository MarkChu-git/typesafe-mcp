import en from "./en.json" with { type: "json" };

type Values = Record<string, string | number>;

function lookup(key: string): unknown {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Looks up a dotted key in the English catalog and fills in {placeholders}. */
export function t(key: string, values: Values = {}): string {
  const template = lookup(key);
  if (typeof template !== "string") throw new Error(`Missing message: ${key}`);
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}
