import type { RefundRequest } from "../types/index.ts";

export async function validateRefund(
  request: RefundRequest,
): Promise<{ approved: boolean; reason?: string }> {
  if (!request.customerId || !request.orderId) {
    return { approved: false, reason: "Missing customer or order ID" };
  }

  if (request.amount <= 0) {
    return { approved: false, reason: "Invalid refund amount" };
  }

  if (request.daysFromDelivery > 90) {
    return { approved: false, reason: "Refund window exceeded" };
  }

  return { approved: true };
}
