import { trackTrialConverted } from "../analytics/events.ts";
import { createInvoice } from "../billing/invoices.ts";
import { activateSubscription } from "../billing/subscriptions.ts";
import { cadenceLabelForTerm, termMonthsForCadence } from "../billing/termLengths.ts";
import { getPlan } from "../catalog/plans.ts";
import { priceFor } from "../pricing/priceFor.ts";
import { listTrialsEndingBy, markTrialConverted } from "../trials/trialStore.ts";
import type { Invoice, Trial } from "../types.ts";

/** Bills the first paid term for one trial and activates its subscription. */
export function convertTrial(trial: Trial, now: Date): Invoice {
  const plan = getPlan(trial.planId);
  const termMonths = termMonthsForCadence(plan.defaultCadence);
  const invoice = createInvoice(
    {
      customerId: trial.customerId,
      subscriptionId: trial.subscriptionId,
      amountCents: priceFor(plan, termMonths),
      currency: plan.currency,
      reason: "trial_conversion",
    },
    now,
  );
  activateSubscription(trial.subscriptionId, now);
  markTrialConverted(trial.id, now.toISOString());
  trackTrialConverted(trial, invoice);
  console.info(`converted ${trial.id}: ${cadenceLabelForTerm(termMonths)} term, ${invoice.amountCents} cents`);
  return invoice;
}

/** Nightly job: converts every trial that has run out. */
export function runTrialConversions(now: Date = new Date()): Invoice[] {
  return listTrialsEndingBy(now.toISOString()).map((trial) => convertTrial(trial, now));
}
