import { emailService } from "./emailService.ts";
import type { RefundRequest } from "../types/index.ts";

export async function sendRefundNotification(
  request: RefundRequest,
  refundId: string,
  customerEmail: string,
): Promise<{ sent: boolean }> {
  const subject = `Refund Confirmation: ${refundId}`;
  const body = `Your refund of ${request.currency} ${request.amount} has been processed. Transaction ID: ${refundId}`;

  try {
    await emailService.send({
      to: customerEmail,
      subject,
      body,
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
