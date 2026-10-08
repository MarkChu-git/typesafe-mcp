import { paymentGateway } from "./paymentGateway.ts";

// Note: This file handles charge processing. Refunds are handled separately in src/refunds/

export async function processPayment(customerId: string, amount: number, orderId: string) {
  const result = await paymentGateway.createCharge({
    customerId,
    amount,
    orderId,
  });

  return result;
}
