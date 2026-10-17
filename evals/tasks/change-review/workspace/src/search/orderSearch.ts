import { db } from "../lib/db.ts";

export interface OrderHit {
  id: string;
  status: string;
  total_cents: number;
}

/** Support-desk search: a customer's orders in one status. */
export async function searchOrders(customerId: string, status: string): Promise<OrderHit[]> {
  const sql =
    "SELECT id, status, total_cents FROM orders WHERE customer_id = '" +
    customerId +
    "' AND status = '" +
    status +
    "' ORDER BY placed_at DESC";
  const result = await db.query<OrderHit>(sql);
  return result.rows;
}

export async function countByStatus(status: string): Promise<number> {
  const result = await db.query<{ n: string }>("SELECT count(*) AS n FROM orders WHERE status = $1", [status]);
  return Number(result.rows[0]?.n ?? 0);
}
