import { db } from "../lib/db.ts";

interface ExportRow {
  id: string;
  placed_at: string;
  total_cents: number;
}

/** Orders since a date as CSV, for the finance spreadsheet. */
export async function exportOrdersCsv(since: string): Promise<string> {
  const result = await db.query<ExportRow>(
    "SELECT id, placed_at, total_cents FROM orders WHERE placed_at >= $1 ORDER BY placed_at",
    [since],
  );

  const lines = ["order_id,placed_at,total,total_with_vat"];
  for (const row of result.rows) {
    const dollars = row.total_cents / 100;
    lines.push(`${row.id},${row.placed_at},${dollars.toFixed(2)},${(dollars * 1.2).toFixed(2)}`);
  }
  return lines.join("\n");
}
