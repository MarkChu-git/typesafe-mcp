import { Pool } from "pg";
import { logger } from "./logger.ts";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

const SLOW_QUERY_MS = 500;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export const db = {
  async query<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const started = performance.now();
    const result = await pool.query(text, [...params]);
    const elapsedMs = Math.round(performance.now() - started);
    if (elapsedMs > SLOW_QUERY_MS) logger.warn({ elapsedMs }, "slow query");
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  },
};

export async function closeDb(): Promise<void> {
  await pool.end();
}
