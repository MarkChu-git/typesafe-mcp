import { createSubscription } from "../billing/subscriptions.ts";
import { getPlan } from "../catalog/plans.ts";
import { addDays } from "../lib/dates.ts";
import { newId } from "../lib/ids.ts";
import { hasHadTrial, saveTrial } from "./trialStore.ts";
import type { BillingChoice, PlanId, Trial } from "../types.ts";

export const TRIAL_DAYS = 14;

export interface StartTrialInput {
  customerId: string;
  planId: PlanId;
  choice: BillingChoice;
}

/** Opens a trial: a trialing subscription now, the first charge once the trial has run out. */
export function startTrial(input: StartTrialInput, now: Date = new Date()): Trial {
  if (hasHadTrial(input.customerId)) {
    throw new Error(`Customer ${input.customerId} has already used a trial`);
  }
  const plan = getPlan(input.planId);
  const endsAt = addDays(now, TRIAL_DAYS).toISOString();
  const { termMonths } = input.choice;
  const subscription = createSubscription({
    customerId: input.customerId,
    planId: plan.id,
    termMonths,
    status: "trialing",
    currentPeriodEnd: endsAt,
  });
  const trial: Trial = {
    id: newId("trial"),
    customerId: input.customerId,
    subscriptionId: subscription.id,
    planId: plan.id,
    startedAt: now.toISOString(),
    endsAt,
  };
  saveTrial(trial);
  return trial;
}
