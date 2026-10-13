import { logger } from "./logger.ts";
import { catalogs } from "./messages.ts";
import type { MessageKey } from "./messages.ts";

export type { MessageKey };

type Params = Readonly<Record<string, string | number>>;

export function hasMessage(key: string): key is MessageKey {
  return key in catalogs.en;
}

/** Looks up the text for a key and fills in its {placeholders}. */
export function t(key: MessageKey, params: Params = {}): string {
  const template: string = catalogs.en[key];
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) logger.warn({ key, placeholder: name }, "missing translation parameter");
    return String(value ?? "");
  });
}
