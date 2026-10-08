import { redact } from "../../src/errors.ts";

export function redactAll(text: string, secrets: readonly string[]): string {
  let result = redact(text);
  for (const secret of secrets) {
    if (secret.length >= 8) {
      result = result.split(secret).join("***");
    }
  }
  return result;
}
