import { addMonths } from "../lib/dates.ts";
import { newId } from "../lib/ids.ts";
import type { PlanId, Subscription, SubscriptionStatus, TermMonths } from "../types.ts";

const subscriptions = new Map<string, Subscription>();

export interface NewSubscription {
  customerId: string;
  planId: PlanId;
  termMonths: TermMonths;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
}

export function createSubscription(input: NewSubscription): Subscription {
  const subscription: Subscription = { ...input, id: newId("sub") };
  subscriptions.set(subscription.id, subscription);
  return subscription;
}

export function getSubscription(id: string): Subscription {
  const subscription = subscriptions.get(id);
  if (!subscription) throw new Error(`Unknown subscription ${id}`);
  return subscription;
}

/** Moves a trialing subscription to active and starts its first paid term at `now`. */
export function activateSubscription(id: string, now: Date): Subscription {
  const subscription = getSubscription(id);
  subscription.status = "active";
  subscription.currentPeriodEnd = addMonths(now, subscription.termMonths).toISOString();
  return subscription;
}

/** Active subscriptions whose paid term has ended. */
export function listSubscriptionsDue(nowIso: string): Subscription[] {
  return [...subscriptions.values()].filter(
    (subscription) => subscription.status === "active" && subscription.currentPeriodEnd <= nowIso,
  );
}

/** Starts the next paid term right after the one that just ended. */
export function extendPeriod(id: string): Subscription {
  const subscription = getSubscription(id);
  const previousEnd = new Date(subscription.currentPeriodEnd);
  subscription.currentPeriodEnd = addMonths(previousEnd, subscription.termMonths).toISOString();
  return subscription;
}

export function cancelSubscription(id: string): Subscription {
  const subscription = getSubscription(id);
  subscription.status = "canceled";
  return subscription;
}

export function listSubscriptions(status?: SubscriptionStatus): Subscription[] {
  const all = [...subscriptions.values()];
  return status === undefined ? all : all.filter((subscription) => subscription.status === status);
}
