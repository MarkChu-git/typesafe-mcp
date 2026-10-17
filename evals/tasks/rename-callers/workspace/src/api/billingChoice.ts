import type { BillingChoice, Cadence, TermMonths } from "../types.ts";

const TERM_MONTHS: Record<Cadence, TermMonths> = { monthly: 1, yearly: 12 };

export function isCadence(value: unknown): value is Cadence {
  return value === "monthly" || value === "yearly";
}

/**
 * Reads the pricing-page toggle from a request body (`billingPeriod`). A missing or unknown
 * value is treated as monthly, the same as a customer who never touched the toggle.
 */
export function parseBillingChoice(body: { billingPeriod?: unknown }): BillingChoice {
  const cadence: Cadence = isCadence(body.billingPeriod) ? body.billingPeriod : "monthly";
  return { cadence, termMonths: TERM_MONTHS[cadence] };
}

/** Human-readable term for responses and logs, e.g. "12-month term". */
export function describeChoice(choice: BillingChoice): string {
  return `${choice.termMonths}-month term`;
}
