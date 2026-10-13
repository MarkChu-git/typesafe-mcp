# Pricing

Prices are in US dollars and exclude tax.

| Plan | Monthly | Yearly |
| --- | --- | --- |
| Solo | $9.00 | $90.00 |
| Team | $24.00 | $240.00 |
| Studio | $69.00 | $690.00 |

A yearly term costs ten months of the monthly price, which is where the "2 months free" badge on the pricing page comes from.

## Coupons

`WELCOME10` takes 10% off. `ANNUAL20` takes 20% off and works only with a yearly term. Coupons apply to the first charge of a direct sign-up; they do not apply to trials or renewals.

## Showing prices

Amounts shown to customers are formatted with `formatPrice()` from `src/lib/money.ts`, which takes cents and a currency code. A range, such as the one in the plan comparison header, goes through `formatPriceRange()` instead.

## Where the numbers live

List prices are defined once, in the plan catalog, keyed by plan and by the length of the term in months. Checkout, conversion and renewals all read them from there.
