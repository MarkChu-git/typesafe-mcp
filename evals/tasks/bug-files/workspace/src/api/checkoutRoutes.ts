import { subscribeNow } from "../billing/checkout.ts";
import { parseBillingChoice } from "./billingChoice.ts";
import type { PlanId } from "../types.ts";

export interface CheckoutRequest {
  customerId: string;
  planId: PlanId;
  billingPeriod?: unknown;
  couponCode?: string;
}

export function handleCheckout(body: CheckoutRequest) {
  const choice = parseBillingChoice(body);
  const { subscription, invoice } = subscribeNow({
    customerId: body.customerId,
    planId: body.planId,
    choice,
    couponCode: body.couponCode,
  });
  return {
    status: 201,
    body: {
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      amountCents: invoice.amountCents,
      display: `$${(invoice.amountCents / 100).toFixed(2)}`,
    },
  };
}
