import type { Order } from "../types/index.ts";

export function validateOrder(order: Order): { valid: boolean; error?: string } {
  if (!order.id || !order.customerId) {
    return { valid: false, error: "Missing required fields" };
  }

  if (!["pending", "completed", "cancelled"].includes(order.status)) {
    return { valid: false, error: "Invalid order status" };
  }

  return { valid: true };
}
