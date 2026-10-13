# Checkout service

The order and checkout API behind the web shop. It prices carts, takes payment through the payment gateway, stores orders in Postgres and sends the transactional emails.

## Layout

- `src/server.ts`: HTTP entry point and routing
- `src/checkout/`: cart, express checkout and gift cards
- `src/orders/`: order storage and order history
- `src/payments/`: gateway client and refund requests
- `src/pricing/` and `src/shipping/`: tax and shipping quotes
- `src/customers/`: profiles and saved addresses
- `src/notifications/`: mail client and order emails
- `src/jobs/`, `src/reports/` and `src/search/`: scheduled jobs, finance exports and the support-desk order search
- `src/lib/`: database, logger, feature flags, translations and errors

## Running it

```bash
bun install
bun run start
```

Configuration comes from environment variables: `PORT`, `DATABASE_URL`, `PAYMENT_GATEWAY_URL`, `MAIL_API_URL`, `FLAG_SERVICE_URL` and `LOG_LEVEL`.

The team's coding rules are in `CONVENTIONS.md`.
