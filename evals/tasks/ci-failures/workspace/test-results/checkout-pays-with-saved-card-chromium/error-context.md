# Test: checkout.spec.ts >> Checkout >> pays with saved card

- Spec: e2e/checkout.spec.ts:58
- Browser: chromium
- Result: failed after 30.1s
- Run: 7731, shard 2 of 4

## Error

```
Error: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByTestId('place-order')
    - locator resolved to 0 elements
```

## Test source

```ts
  53 |   await expect(page.getByTestId('order-total')).toHaveText('$74.20');
  54 |   await page.getByLabel('Save card for next time').uncheck();
  55 |   await page.getByRole('checkbox', { name: 'I agree to the terms' }).check();
  56 |   await page.waitForLoadState('networkidle');
  57 |   await expect(page.getByRole('region', { name: 'Order summary' })).toBeVisible();
> 58 |   await page.getByTestId('place-order').click();
     |                                         ^
  59 |   await expect(page).toHaveURL(/\/orders\/.+\/confirmation/, { timeout: 30_000 });
```

## Page snapshot

```yaml
- heading "Checkout" [level=1]
- group "Payment":
  - combobox "Saved cards": Visa ending 6411
  - button "Use saved card"
- region "Order summary":
  - text: Items 2
  - text: Total $74.20
  - button "Pay now"
```
