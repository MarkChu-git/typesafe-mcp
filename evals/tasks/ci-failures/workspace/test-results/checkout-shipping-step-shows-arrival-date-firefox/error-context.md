# Test: checkout.spec.ts >> Checkout >> shipping step shows arrival date

- Spec: e2e/checkout.spec.ts:97
- Browser: firefox
- Result: failed after 5.0s

## Error

```
Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('shipping-arrival')
Expected string: "Arrives Oct 16 – Oct 17"
Received string: "Arrives undefined – undefined"
Timeout: 5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for getByTestId('shipping-arrival')
  - locator resolved to <p data-testid="shipping-arrival">Arrives undefined – undefined</p>
```

## Test source

```ts
  93 |   await page.goto('/checkout');
  94 |   await page.getByLabel('Postcode').fill('12345');
  95 |   await page.getByRole('radio', { name: 'Express' }).check();
  96 |   await page.waitForResponse((res) => res.url().includes('/api/shipping-quote'));
> 97 |   await expect(page.getByTestId('shipping-arrival')).toHaveText('Arrives Oct 16 – Oct 17');
     |                                                     ^
  98 | });
```

## Server log

```
[shipping] GET /api/shipping-quote?postcode=12345&method=express 200 49ms
[shipping] body {"method":"express","price":1299,"deliveryWindow":{"from":"2026-10-16","to":"2026-10-17"}}
```
