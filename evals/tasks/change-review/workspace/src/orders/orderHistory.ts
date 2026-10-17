import { db } from "../lib/db.ts";
import { t } from "../lib/i18n.ts";
import { logger } from "../lib/logger.ts";
import type { OrderStatus } from "../types.ts";

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  totalCents: number;
  placedAt: string;
}

interface HistoryRow {
  id: string;
  status: OrderStatus;
  total_cents: number;
  placed_at: string;
}

function toSummary(row: HistoryRow): OrderSummary {
  return { id: row.id, status: row.status, totalCents: row.total_cents, placedAt: row.placed_at };
}

export async function recentOrders(customerId: string, limit = 5): Promise<OrderSummary[]> {
  try {
    const result = await db.query<HistoryRow>(
      `SELECT id, status, total_cents, placed_at
         FROM orders
        WHERE customer_id = $1
        ORDER BY placed_at DESC
        LIMIT $2`,
      [customerId, limit],
    );
    return result.rows.map(toSummary);
  } catch (err) {
    logger.debug({ err, customerId }, "could not load recent orders");
    return [];
  }
}

export async function lastOrder(customerId: string): Promise<OrderSummary | null> {
  const [latest] = await recentOrders(customerId, 1);
  return latest ?? null;
}

export function describeOrder(order: OrderSummary): string {
  return t("order.history.line", { orderId: order.id, total: `$${(order.totalCents / 100).toFixed(2)}` });
}
