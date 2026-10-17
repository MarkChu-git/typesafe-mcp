export interface ShippingQuote {
  label: string;
  priceCents: number;
}

const FREE_SHIPPING_FROM_CENTS = 5000;
const PER_KG_DOLLARS = 4.35;

const TRANSIT_DAYS: Readonly<Record<string, number>> = { WA: 2, OR: 2, CA: 3, TX: 4, NY: 5 };

/** Working days a parcel takes to reach a region. */
export function transitDays(region: string): number {
  return TRANSIT_DAYS[region] ?? 6;
}

/** Shipping options offered at checkout. */
export function quoteShipping(subtotalCents: number, weightKg: number): ShippingQuote {
  if (subtotalCents >= FREE_SHIPPING_FROM_CENTS) {
    return { label: "Free shipping on orders over $50", priceCents: 0 };
  }
  const dollars = weightKg * PER_KG_DOLLARS;
  return { label: "Standard shipping", priceCents: Math.round(dollars * 100) };
}
