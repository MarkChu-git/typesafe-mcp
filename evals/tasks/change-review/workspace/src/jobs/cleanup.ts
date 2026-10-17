import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";

const STEPS = [
  { name: "expired carts", sql: "DELETE FROM carts WHERE updated_at < now() - interval '30 days'" },
  { name: "stale sessions", sql: "DELETE FROM sessions WHERE expires_at < now()" },
  { name: "old drafts", sql: "DELETE FROM order_drafts WHERE created_at < now() - interval '7 days'" },
] as const;

/** Nightly housekeeping. Each step is independent of the others. */
export async function runCleanup(): Promise<void> {
  for (const step of STEPS) {
    try {
      const result = await db.query(step.sql);
      logger.info({ step: step.name, removed: result.rowCount }, "cleanup step finished");
    } catch (err) {
      logger.warn({ step: step.name, err }, "cleanup step failed");
    }
  }
}
