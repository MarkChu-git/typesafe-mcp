# Billing flow

How a customer moves through the service, from the pricing page to the second year.

## Pricing page

The pricing page shows every plan with a toggle for the billing interval, monthly or yearly. Whatever the customer picks travels with the request as `billingPeriod`. List prices are in [pricing.md](pricing.md).

## Signing up

There are two ways in.

- Direct checkout: the customer pays for the first term right away and the subscription is active from the start.
- Free trial: the customer gets 14 days without a charge. A subscription is created in the `trialing` state and nothing is billed. Each customer can have one trial.

## Reminders

Three days before a trial ends, the reminder job emails the customer to say that their card will be charged when the trial is over.

## Trial conversion

The conversion job runs every night. For each trial whose 14 days are up, it prices the first charge from the trial, issues an invoice with the reason `trial_conversion`, activates the subscription and marks the trial as converted. Activation starts the first paid term.

## Renewals

The renewal job runs after conversion. Every active subscription whose paid term has ended is charged the plan price for its term, and the next term starts where the last one stopped.

## Invoices and receipts

Every charge produces an invoice. The receipt email and the revenue report in `src/admin/` are both built from those invoices.
