import type { BillingChoice, Invoice, Trial } from "../types.ts";

export type EventProperties = Record<string, string | number>;

export interface AnalyticsEvent {
  name: string;
  at: string;
  properties: EventProperties;
}

const events: AnalyticsEvent[] = [];

export function track(name: string, properties: EventProperties, at: Date = new Date()): void {
  events.push({ name, at: at.toISOString(), properties });
}

export function trackTrialStarted(trial: Trial, choice: BillingChoice): void {
  track("trial_started", {
    trialId: trial.id,
    plan: trial.planId,
    interval: choice.cadence,
    termMonths: choice.termMonths,
  });
}

export function trackTrialConverted(trial: Trial, invoice: Invoice): void {
  track("trial_converted", {
    trialId: trial.id,
    plan: trial.planId,
    priceCents: invoice.amountCents,
  });
}

export function eventsNamed(name: string): AnalyticsEvent[] {
  return events.filter((event) => event.name === name);
}

/** Share of started trials that have converted so far, between 0 and 1. */
export function conversionRate(): number {
  const started = eventsNamed("trial_started").length;
  if (started === 0) return 0;
  return eventsNamed("trial_converted").length / started;
}
