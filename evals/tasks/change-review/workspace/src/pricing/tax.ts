import type { Address } from "../types.ts";

/** Sales tax per region in basis points, so 825 means 8.25%. */
const RATE_BPS: Readonly<Record<string, number>> = {
  CA: 725,
  NY: 400,
  OR: 0,
  TX: 625,
  WA: 825,
};

export interface Quote {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function rateBps(region: string): number {
  return RATE_BPS[region] ?? 0;
}

/** Tax on a subtotal, rounded once to whole cents. */
export function taxCents(subtotalCents: number, region: string): number {
  return Math.round((subtotalCents * rateBps(region)) / 10_000);
}

export function quote(subtotalCents: number, address: Address): Quote {
  const tax = taxCents(subtotalCents, address.region);
  return { subtotalCents, taxCents: tax, totalCents: subtotalCents + tax };
}

/** Quote for the express screen, which prices the whole basket in one step. */
export function quoteExpress(subtotalCents: number, address: Address): Quote {
  const subtotal = subtotalCents / 100;
  const total = subtotal * (1 + rateBps(address.region) / 10_000);
  const totalCents = Math.round(total * 100);
  return { subtotalCents, taxCents: totalCents - subtotalCents, totalCents };
}
