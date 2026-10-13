# Test: checkout.spec.ts >> Checkout >> confirms order after review

- Spec: e2e/checkout.spec.ts:130
- Browser: chromium
- Result: failed after 30.2s

## Error

```
Error: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByTestId('pay-now')
  - locator resolved to <button type="submit">Pay now</button>
  - attempting click action
  - <div role="status" class="toast toast--info">Thanks, you're on the list</div> from <div class="toast-region"> subtree intercepts pointer events
  - retrying click action
  - waiting 20ms
  - <div role="status" class="toast toast--info">Thanks, you're on the list</div> from <div class="toast-region"> subtree intercepts pointer events
  - retrying click action (repeats until the timeout)
```

## Test source

```ts
 126 |   await page.goto('/checkout/review');
 127 |   await page.getByLabel('I agree to the terms').check();
 128 |   await expect(page.getByTestId('order-total')).toHaveText('$38.00');
 129 |   await page.waitForLoadState('networkidle');
> 130 |   await page.getByTestId('pay-now').click();
     |                                     ^
 131 |   await expect(page).toHaveURL(/\/orders\/.+\/confirmation/);
 132 | });
```

## Page snapshot

```yaml
- status:
  - text: Thanks, you're on the list
  - button "Dismiss"
- heading "Review your order" [level=1]
- text: Total $38.00
- button "Pay now"
```
