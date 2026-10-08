import { database } from "../db/database.ts";

export async function createUser(email: string, name: string) {
  const userId = `user_${Date.now()}`;

  await database.query("INSERT INTO users (id, email, name) VALUES ($1, $2, $3)", [userId, email, name]);

  return { id: userId, email, name };
}

export async function getUser(userId: string) {
  const result = await database.query("SELECT * FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}
