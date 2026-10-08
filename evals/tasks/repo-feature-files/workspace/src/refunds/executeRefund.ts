import { reversePayment } from "../payments/reversals.ts";
import type { RefundRequest } from "../types/index.ts";

export async function executeRefund(request: RefundRequest): Promise<{ success: boolean; error?: string; transactionId: string }> {
  try {
    const result = await reversePayment({
      originalChargeId: request.chargeId,
      amount: request.amount,
      currency: request.currency,
    });

    return { success: result.success, transactionId: result.transactionId };
  } catch (error) {
    return { success: false, error: String(error), transactionId: "" };
  }
}
