import { validateRefund } from "./validateRefund.ts";
import { executeRefund } from "./executeRefund.ts";
import { recordRefund } from "./recordRefund.ts";
import type { RefundRequest } from "../types/index.ts";

export async function processRefund(request: RefundRequest): Promise<{ success: boolean; refundId: string }> {
  const validation = await validateRefund(request);
  if (!validation.approved) {
    throw new Error(`Refund denied: ${validation.reason}`);
  }

  const execution = await executeRefund(request);
  if (!execution.success) {
    throw new Error(`Failed to execute refund: ${execution.error}`);
  }

  const recorded = await recordRefund(request, execution.transactionId);
  return { success: true, refundId: recorded.refundId };
}
