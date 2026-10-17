# PR #519: "Pay now" button and delivery windows

- Author: @lena-quist (fork: lena-quist/shop)
- Base: main
- Status: CI red on run 7731, waiting for review

## What it changes

- Checkout page: the submit button reads "Pay now" instead of "Place order". Its test id moved from `place-order` to `pay-now`.
- Shipping quote endpoint (`GET /api/shipping-quote`): the response carries `deliveryWindow: { from, to }` with ISO dates. The `etaDays` field is removed.
- Cart summary: the delivery line shows the window as a date range, such as "Arrives Oct 16 – Oct 19". It used to show "Estimated delivery: 3-5 days".
- Checkout page: the shipping step shows the same date range.

## Notes

- Totals, tax and the payment flow are unchanged.
- No database migration.
