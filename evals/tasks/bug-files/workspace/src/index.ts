import { handleCheckout } from "./api/checkoutRoutes.ts";
import { handleStartTrial } from "./api/trialRoutes.ts";
import { sendTrialEndingEmails } from "./emails/trialEnding.ts";
import { runTrialConversions } from "./jobs/convertTrials.ts";
import { runRenewals } from "./jobs/renewals.ts";
import type { Email } from "./types.ts";

export const routes = {
  "POST /trials": handleStartTrial,
  "POST /checkout": handleCheckout,
} as const;

const outbox: Email[] = [];

const mailer = {
  emailFor: (customerId: string) => `${customerId}@mail.example.invalid`,
  deliver: (email: Email) => {
    outbox.push(email);
  },
};

/** Nightly jobs in the order the scheduler runs them (02:00 UTC). */
export const nightlyJobs = [
  { name: "trial-ending-emails", run: (now: Date) => sendTrialEndingEmails(now, mailer) },
  { name: "convert-trials", run: (now: Date) => runTrialConversions(now).length },
  { name: "renewals", run: (now: Date) => runRenewals(now).length },
] as const;

/** Runs every nightly job once and reports how many items each one handled. */
export function runNightly(now: Date = new Date()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of nightlyJobs) counts[job.name] = job.run(now);
  return counts;
}
