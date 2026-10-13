# Test: checkout-guest.spec.ts >> Guest checkout >> completes purchase as a guest

- Spec: e2e/checkout-guest.spec.ts:24
- Browser: webkit
- Result: failed after 30.0s
- Run: 7731, shard 4 of 4

## Error

```
Error: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Place order' })
```

## Test source

```ts
  19 |   await page.goto('/checkout/guest');
  20 |   await page.getByLabel('Email').fill('shopper.7731@example.com');
  21 |   await page.getByLabel('Postcode').fill('12345');
  22 |   await page.getByRole('radio', { name: 'Standard' }).check();
  23 |   await page.getByRole('checkbox', { name: 'I agree to the terms' }).check();
> 24 |   await page.getByRole('button', { name: 'Place order' }).click();
     |                                                           ^
  25 |   await expect(page).toHaveURL(/\/orders\/.+\/confirmation/);
  26 | });
```

## Page snapshot

```yaml
- banner:
  - link "Shop"
- main:
  - heading "Guest checkout" [level=1]
  - textbox "Email": shopper.7731@example.com
  - textbox "Postcode": "12345"
  - radio "Standard" [checked]
  - radio "Express"
  - region "Order summary":
    - text: Total $38.00
    - button "Pay now"
```
