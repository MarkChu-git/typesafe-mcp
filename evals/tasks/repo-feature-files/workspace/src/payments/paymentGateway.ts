interface ChargeRequest {
  customerId: string;
  amount: number;
  orderId: string;
}

interface RefundRequest {
  chargeId: string;
  amount: number;
  currency: string;
}

export const paymentGateway = {
  async createCharge(request: ChargeRequest) {
    // Stub: would connect to Stripe, PayPal, etc.
    return { chargeId: `ch_${Date.now()}`, success: true };
  },

  async createRefund(request: RefundRequest) {
    // Stub: would connect to payment provider
    return { refundId: `ref_${Date.now()}`, success: true };
  },
};
