# Subscription billing

Billing backend for a note-taking app. It starts free trials, takes direct sign-ups, charges renewals every night and sends the emails around those events. State is kept in memory, so there is no database to set up.

## Layout

| Path | Contents |
| --- | --- |
| `src/api/` | Request handlers and request parsing |
| `src/billing/` | Subscriptions, invoices and direct checkout |
| `src/trials/` | Starting trials and keeping them |
| `src/jobs/` | The nightly jobs |
| `src/catalog/`, `src/pricing/` | Plans and price lookup |
| `src/promos/` | Coupons |
| `src/emails/`, `src/i18n/` | Email builders and the English message catalog |
| `src/analytics/` | Product analytics events |
| `src/admin/` | Internal reports |
| `src/lib/` | Small helpers for dates and ids |
| `src/seeds/` | Sample rows for local development |
| `config/` | Static config shared with the web app |
| `docs/` | Notes on the billing flow and on pricing |

## Running it

```sh
bun install
bun run start
bun run typecheck
```

The nightly jobs are listed in `src/index.ts` and run at 02:00 UTC. Call `runNightly()` from a REPL to trigger them by hand.
