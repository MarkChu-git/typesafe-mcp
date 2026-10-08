import { database } from "../db/database.ts";
import type { RefundRequest } from "../types/index.ts";

export async function recordRefund(
  request: RefundRequest,
  transactionId: string,
): Promise<{ refundId: string }> {
  const refundId = `ref_${Date.now()}`;

  await database.query(
    "INSERT INTO refunds (id, order_id, customer_id, amount, transaction_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [refundId, request.orderId, request.customerId, request.amount, transactionId, new Date()],
  );

  return { refundId };
}
