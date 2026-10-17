import { getSubscription } from "../billing/subscriptions.ts";
import { getPlan } from "../catalog/plans.ts";
import { t } from "../i18n/index.ts";
import { addDays, isoDay } from "../lib/dates.ts";
import { priceFor } from "../pricing/priceFor.ts";
import { listTrialsEndingBetween } from "../trials/trialStore.ts";
import type { Email, Trial } from "../types.ts";

const REMINDER_DAYS = 3;

export interface ReminderDeps {
  emailFor(customerId: string): string;
  deliver(email: Email): void;
}

/** The reminder tells the customer which term they will be charged for when the trial ends. */
export function buildTrialEndingEmail(trial: Trial, to: string): Email {
  const plan = getPlan(trial.planId);
  const subscription = getSubscription(trial.subscriptionId);
  const cadence = subscription.termMonths === 12 ? "yearly" : "monthly";
  const amount = `$${(priceFor(plan, subscription.termMonths) / 100).toFixed(2)}`;
  return {
    to,
    subject: t("trialEnding.subject", { plan: plan.name }),
    body: t("trialEnding.body", {
      plan: plan.name,
      date: isoDay(new Date(trial.endsAt)),
      amount,
      cadence: t(`cadence.${cadence}`),
    }),
  };
}

/** Nightly: remind customers whose trial ends three days from now, so each trial is reminded once. */
export function sendTrialEndingEmails(now: Date, deps: ReminderDeps): number {
  const from = addDays(now, REMINDER_DAYS - 1).toISOString();
  const upcoming = listTrialsEndingBetween(from, addDays(now, REMINDER_DAYS).toISOString());
  for (const trial of upcoming) {
    deps.deliver(buildTrialEndingEmail(trial, deps.emailFor(trial.customerId)));
  }
  return upcoming.length;
}
