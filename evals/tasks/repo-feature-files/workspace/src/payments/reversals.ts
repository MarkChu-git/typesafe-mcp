import { paymentGateway } from "./paymentGateway.ts";

interface RefundParams {
  originalChargeId: string;
  amount: number;
  currency: string;
}

export async function reversePayment(params: RefundParams): Promise<{ success: boolean; transactionId: string }> {
  try {
    const result = await paymentGateway.createRefund({
      chargeId: params.originalChargeId,
      amount: params.amount,
      currency: params.currency,
    });

    return { success: true, transactionId: result.refundId };
  } catch (error) {
    return { success: false, transactionId: "" };
  }
}
