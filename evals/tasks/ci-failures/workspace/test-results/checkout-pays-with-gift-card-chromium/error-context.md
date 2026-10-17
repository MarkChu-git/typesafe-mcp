# Test: checkout.spec.ts >> Checkout >> pays with gift card

- Spec: e2e/checkout.spec.ts:86
- Browser: chromium
- Result: failed after 30.0s

## Error

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/orders\/.+\/confirmation/
Received string: "https://shop.example.com/checkout/pay"
Timeout: 30000ms

Call log:
  - Expect "toHaveURL" with timeout 30000ms
  - waiting for getByTestId('pay-now')
  - locator resolved to <button type="submit">Pay now</button>
  - click action done
  - waiting for navigation to /orders/…/confirmation
```

## Test source

```ts
  82 |   await page.getByLabel('Gift card code').fill(fixtures.giftCardCode);
  83 |   await page.getByRole('button', { name: 'Apply gift card' }).click();
  84 |   await expect(page.getByTestId('order-total')).toHaveText('$12.50');
  85 |   await page.getByTestId('pay-now').click();
> 86 |   await expect(page).toHaveURL(/\/orders\/.+\/confirmation/, { timeout: 30_000 });
     |                      ^
  87 | });
```

## Server log

```
[payments] POST /api/payments/intents 202 (gift card, 1 intent)
[payments] intent 4481 still pending after 30.0s
[payments] intent 4481 succeeded after 33.7s
[checkout] order 90417 created after payment callback
```
