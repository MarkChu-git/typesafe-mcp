import type { TermMonths } from "../types.ts";

export interface Coupon {
  code: string;
  percentOff: number;
  /** Valid only when the customer pays for a 12-month (yearly) term. */
  yearlyOnly: boolean;
}

const COUPONS: readonly Coupon[] = [
  { code: "WELCOME10", percentOff: 10, yearlyOnly: false },
  { code: "ANNUAL20", percentOff: 20, yearlyOnly: true },
];

export function findCoupon(code: string | undefined): Coupon | undefined {
  if (code === undefined) return undefined;
  return COUPONS.find((coupon) => coupon.code === code.trim().toUpperCase());
}

/** Price after the coupon. Coupons apply to the first charge of a direct sign-up only. */
export function applyCoupon(amountCents: number, code: string | undefined, termMonths: TermMonths): number {
  const coupon = findCoupon(code);
  if (!coupon) return amountCents;
  if (coupon.yearlyOnly && termMonths !== 12) return amountCents;
  return Math.round(amountCents * (1 - coupon.percentOff / 100));
}

/** Short text for the checkout page, such as "ANNUAL20 saves $48.00 on this order". */
export function describeSavings(
  amountCents: number,
  code: string | undefined,
  termMonths: TermMonths,
): string | null {
  const coupon = findCoupon(code);
  if (!coupon) return null;
  const saved = amountCents - applyCoupon(amountCents, code, termMonths);
  if (saved <= 0) return null;
  return `${coupon.code} saves $${(saved / 100).toFixed(2)} on this order`;
}
