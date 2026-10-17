# Team conventions

Six rules for all code in this repository. Every pull request is checked against them. Each rule comes with its reason and one example that is fine next to one that is not.

## 1. Money is integer cents

Keep every amount of money as a whole number of cents and never do floating-point arithmetic on it. Converting to fractional dollars, calculating there and converting back counts as floating-point arithmetic, even when the result is rounded to cents. Scaling a whole number of cents by a rate given in basis points and rounding once is fine, and so is formatting cents for display.

Why: most decimal fractions have no exact binary form, so sums and percentages drift by a cent and our totals stop matching what the payment provider charged.

Fine:

```ts
const feeCents = Math.round((amountCents * feeBps) / 10_000);
const label = `$${(amountCents / 100).toFixed(2)}`; // display only
```

Not fine:

```ts
const discounted = Math.round(price * 0.9 * 100); // price is a fractional dollar amount
const sum = 0.1 + 0.2; // not exactly 0.3
```

## 2. Do not swallow errors

A catch block has to rethrow, return an error result, or report the error. An empty catch breaks the rule, and so does a catch that only writes a log line and then carries on as if nothing had happened. An error result is a value the caller can tell apart from success, such as `{ ok: false, error }`. Reporting means calling `reportError(err)`.

Why: a failure that vanishes into a log line shows up later as wrong data, far from its cause, and nobody is alerted.

Fine:

```ts
try {
  await reserveStock(order);
} catch (err) {
  throw new AppError("INTERNAL", { cause: err });
}
```

Not fine:

```ts
try {
  await syncInventory();
} catch (err) {
  logger.warn({ err }, "inventory sync failed");
}
```

## 3. Never log personal data

Do not write a customer's email, name, phone number, address or card digits to a log, whether as a plain value or inside an object that carries them. Ids are fine.

Why: logs are copied to third-party tools and kept for months, so personal data in them is a leak waiting to happen and cannot be deleted on request.

Fine:

```ts
logger.info({ orderId, customerId }, "order placed");
```

Not fine:

```ts
logger.info({ email, phone }, "profile updated");
```

## 4. Feature flags go through flags.isOn

Ask `flags.isOn(name)` whether a feature is on. Do not read `process.env` to decide that. Reading `process.env` for other configuration, such as a port or a service URL, is fine.

Why: flags change at runtime and every change is audited in one place, while an environment variable needs a redeploy and leaves no record of who flipped it.

Fine:

```ts
if (flags.isOn("new_search")) return searchV2(query);
const port = Number(process.env.PORT ?? 3000);
```

Not fine:

```ts
const useSearchV2 = Boolean(process.env.USE_SEARCH_V2);
```

## 5. Customer-facing text goes through t()

Anything a customer reads, whether in an API response, an email or the UI, comes from `t(key)`. No hard-coded English there. Log messages and error codes are for engineers and stay in English.

Why: the content team translates and reviews the catalog in one place, and a literal string stays English in every market.

Fine:

```ts
const label = t("cart.checkout_button");
logger.info("cart opened");
throw new AppError("NOT_FOUND");
```

Not fine:

```tsx
<button>Add to basket</button>
```

## 6. SQL is parameterized

Pass values to the database as parameters (`$1`, `$2` and so on). Never build a query by concatenating or interpolating a value into its text. Interpolating a constant table name is fine.

Why: a value that reaches the query text can change what the query does, which is how SQL injection works.

Fine:

```ts
db.query("SELECT id FROM orders WHERE status = $1", [status]);
db.query(`SELECT id FROM ${ORDERS_TABLE} WHERE id = $1`, [id]);
```

Not fine:

```ts
db.query("SELECT id FROM orders WHERE status = '" + status + "'");
```
