import { getPlan } from "../catalog/plans.ts";
import { addMonths } from "../lib/dates.ts";
import { priceFor } from "../pricing/priceFor.ts";
import { applyCoupon } from "../promos/coupons.ts";
import { createInvoice } from "./invoices.ts";
import { createSubscription } from "./subscriptions.ts";
import type { BillingChoice, Invoice, PlanId, Subscription } from "../types.ts";

export interface SubscribeInput {
  customerId: string;
  planId: PlanId;
  choice: BillingChoice;
  couponCode?: string | undefined;
}

export interface SubscribeResult {
  subscription: Subscription;
  invoice: Invoice;
}

/** Direct sign-up without a trial: the first term is billed immediately. */
export function subscribeNow(input: SubscribeInput, now: Date = new Date()): SubscribeResult {
  const plan = getPlan(input.planId);
  const { termMonths } = input.choice;
  const subscription = createSubscription({
    customerId: input.customerId,
    planId: plan.id,
    termMonths,
    status: "active",
    currentPeriodEnd: addMonths(now, termMonths).toISOString(),
  });
  const invoice = createInvoice(
    {
      customerId: input.customerId,
      subscriptionId: subscription.id,
      amountCents: applyCoupon(priceFor(plan, termMonths), input.couponCode, termMonths),
      currency: plan.currency,
      reason: "signup",
    },
    now,
  );
  return { subscription, invoice };
}
