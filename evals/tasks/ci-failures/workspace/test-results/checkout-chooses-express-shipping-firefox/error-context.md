# Test: checkout.spec.ts >> Checkout >> chooses express shipping

- Spec: e2e/checkout.spec.ts:44
- Browser: firefox
- Result: failed after 30.1s

## Error

```
Error: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Continue to payment' })
  - locator resolved to <button type="button">Continue to payment</button>
  - attempting click action
  - <div role="status" class="toast toast--success">Address saved</div> from <div class="toast-region"> subtree intercepts pointer events
  - retrying click action
```

## Test source

```ts
  40 |   await page.goto('/checkout');
  41 |   await page.getByLabel('Street address').fill('12 Quarry Lane');
  42 |   await page.getByRole('button', { name: 'Save address' }).click();
  43 |   await page.getByRole('radio', { name: 'Express' }).check();
> 44 |   await page.getByRole('button', { name: 'Continue to payment' }).click();
     |                                                                  ^
  45 |   await expect(page).toHaveURL(/\/checkout\/pay/);
  46 | });
```

## Server log

```
[shipping] GET /api/shipping-quote?postcode=12345&method=express 200 47ms
[shipping] body {"method":"express","price":1299,"deliveryWindow":{"from":"2026-10-15","to":"2026-10-16"}}
[checkout] address saved, session 5c1e
```

## Page snapshot

```yaml
- status:
  - text: Address saved
- heading "Choose shipping" [level=2]
- radio "Express" [checked]
- radio "Standard"
- button "Continue to payment"
```
