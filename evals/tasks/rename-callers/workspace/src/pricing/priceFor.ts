import type { Plan, TermMonths } from "../types.ts";

/** List price in cents for one billing term of a plan. */
export function priceFor(plan: Plan, termMonths: TermMonths): number {
  const cents = plan.priceByMonths[termMonths];
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`Plan ${plan.id} has no valid price for a ${termMonths}-month term`);
  }
  return cents;
}

/** What a 12-month term saves compared with paying month by month. */
export function yearlySavingsCents(plan: Plan): number {
  return priceFor(plan, 1) * 12 - priceFor(plan, 12);
}

/** The price per month once a term is spread over its months, rounded to a cent. */
export function monthlyEquivalentCents(plan: Plan, termMonths: TermMonths): number {
  return Math.round(priceFor(plan, termMonths) / termMonths);
}
