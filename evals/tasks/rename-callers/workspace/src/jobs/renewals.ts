import { createInvoice } from "../billing/invoices.ts";
import { extendPeriod, listSubscriptionsDue } from "../billing/subscriptions.ts";
import { getPlan } from "../catalog/plans.ts";
import { formatPrice } from "../lib/money.ts";
import { priceFor } from "../pricing/priceFor.ts";
import type { Invoice, Subscription } from "../types.ts";

function renew(subscription: Subscription, now: Date): Invoice {
  const plan = getPlan(subscription.planId);
  const invoice = createInvoice(
    {
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      amountCents: priceFor(plan, subscription.termMonths),
      currency: plan.currency,
      reason: "renewal",
    },
    now,
  );
  extendPeriod(subscription.id);
  console.info(`renewed ${subscription.id}: ${formatPrice(invoice.amountCents, invoice.currency)}`);
  return invoice;
}

/** Nightly job: charges every active subscription whose paid term has ended. */
export function runRenewals(now: Date = new Date()): Invoice[] {
  return listSubscriptionsDue(now.toISOString()).map((subscription) => renew(subscription, now));
}
