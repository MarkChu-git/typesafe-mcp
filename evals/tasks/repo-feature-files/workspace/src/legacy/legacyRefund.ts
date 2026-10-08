// DEPRECATED: This file is no longer in use. Refund processing has been moved to src/refunds/
// Do not use this code. It will be removed in a future version.

export async function processRefundLegacy(orderId: string) {
  // Old implementation - DO NOT USE
  throw new Error("This function is deprecated. Use processRefund from src/refunds/refundProcessor.ts instead");
}
