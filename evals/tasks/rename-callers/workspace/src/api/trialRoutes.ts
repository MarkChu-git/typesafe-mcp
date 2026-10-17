import { trackTrialStarted } from "../analytics/events.ts";
import { startTrial } from "../trials/startTrial.ts";
import { describeChoice, parseBillingChoice } from "./billingChoice.ts";
import type { PlanId } from "../types.ts";

export interface StartTrialRequest {
  customerId: string;
  planId: PlanId;
  billingPeriod?: unknown;
}

export function handleStartTrial(body: StartTrialRequest) {
  const choice = parseBillingChoice(body);
  const trial = startTrial({ customerId: body.customerId, planId: body.planId, choice });
  trackTrialStarted(trial, choice);
  return {
    status: 201,
    body: {
      trialId: trial.id,
      endsAt: trial.endsAt,
      term: describeChoice(choice),
    },
  };
}
