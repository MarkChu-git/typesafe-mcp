/**
 * @deprecated Replaced by jobs/convertTrials.ts in the 2.0 billing rewrite. Nothing imports this
 * file and the scheduler no longer runs it; it stays in the tree until the old billing export
 * is retired.
 */
import { createInvoice } from "../billing/invoices.ts";
import { activateSubscription } from "../billing/subscriptions.ts";
import { getPlan } from "../catalog/plans.ts";
import { listTrialsEndingBy, markTrialConverted } from "../trials/trialStore.ts";

/** The old export only carried one price per plan, so every conversion was billed at it. */
export function convertTrialsLegacy(now: Date): number {
  let converted = 0;
  for (const trial of listTrialsEndingBy(now.toISOString())) {
    const plan = getPlan(trial.planId);
    createInvoice(
      {
        customerId: trial.customerId,
        subscriptionId: trial.subscriptionId,
        amountCents: plan.priceByMonths[1],
        currency: plan.currency,
        reason: "trial_conversion",
      },
      now,
    );
    activateSubscription(trial.subscriptionId, now);
    markTrialConverted(trial.id, now.toISOString());
    converted += 1;
  }
  return converted;
}
