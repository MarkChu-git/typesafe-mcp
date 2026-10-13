import { db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import type { Order, SavedCard } from "../types.ts";

/** Queues a refund for the finance team to pay out. Nothing is sent to the gateway from here. */
export async function requestRefund(order: Order, card: SavedCard, amountCents: number): Promise<void> {
  if (amountCents <= 0 || amountCents > order.totalCents) throw new AppError("INVALID_AMOUNT");

  await db.query(
    "INSERT INTO refund_requests (order_id, amount_cents, card_brand, requested_at) VALUES ($1, $2, $3, now())",
    [order.id, amountCents, card.brand],
  );
  logger.info(`refund of ${amountCents} cents queued for order ${order.id} to ${card.brand} card ending ${card.last4}`);
}

export async function pendingRefundCents(orderId: string): Promise<number> {
  const result = await db.query<{ total: string | null }>(
    "SELECT sum(amount_cents) AS total FROM refund_requests WHERE order_id = $1 AND paid_at IS NULL",
    [orderId],
  );
  return Number(result.rows[0]?.total ?? 0);
}
