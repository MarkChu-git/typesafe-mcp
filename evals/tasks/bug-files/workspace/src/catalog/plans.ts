import type { Plan, PlanId } from "../types.ts";

const PLANS: readonly Plan[] = [
  {
    id: "solo",
    name: "Solo",
    currency: "usd",
    defaultCadence: "monthly",
    priceByMonths: { 1: 900, 12: 9000 },
  },
  {
    id: "team",
    name: "Team",
    currency: "usd",
    defaultCadence: "monthly",
    priceByMonths: { 1: 2400, 12: 24000 },
  },
  {
    id: "studio",
    name: "Studio",
    currency: "usd",
    defaultCadence: "monthly",
    priceByMonths: { 1: 6900, 12: 69000 },
  },
];

export function listPlans(): readonly Plan[] {
  return PLANS;
}

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`Unknown plan ${id}`);
  return plan;
}
