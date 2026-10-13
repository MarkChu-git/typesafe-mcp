export type PlanId = "solo" | "team" | "studio";
export type Cadence = "monthly" | "yearly";
export type TermMonths = 1 | 12;
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";
export type InvoiceReason = "signup" | "trial_conversion" | "renewal";

export interface Plan {
  id: PlanId;
  name: string;
  currency: string;
  /** Cadence the plan is sold at when the customer has not picked one. */
  defaultCadence: Cadence;
  /** List price in cents, keyed by the length of the billing term. */
  priceByMonths: Record<TermMonths, number>;
}

/** What the customer picked on the pricing page. */
export interface BillingChoice {
  cadence: Cadence;
  termMonths: TermMonths;
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  /** Length of one paid term; renewals charge the plan price for this many months. */
  termMonths: TermMonths;
  currentPeriodEnd: string;
}

export interface Trial {
  id: string;
  customerId: string;
  subscriptionId: string;
  planId: PlanId;
  startedAt: string;
  endsAt: string;
  /** Missing on trials created before cadences were recorded. */
  cadence?: Cadence;
  convertedAt?: string;
}

export interface Invoice {
  id: string;
  customerId: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  reason: InvoiceReason;
  issuedAt: string;
}

export interface Email {
  to: string;
  subject: string;
  body: string;
}
