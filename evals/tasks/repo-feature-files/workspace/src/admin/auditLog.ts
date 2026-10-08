import { database } from "../db/database.ts";

export async function logAction(action: string, userId: string, details: unknown): Promise<void> {
  await database.query(
    "INSERT INTO audit_log (action, user_id, details, timestamp) VALUES ($1, $2, $3, $4)",
    [action, userId, JSON.stringify(details), new Date()],
  );
}
