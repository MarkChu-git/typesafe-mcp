# Test: cart.spec.ts >> Cart >> summary matches snapshot

- Spec: e2e/cart.spec.ts:70
- Browser: chromium
- Result: failed after 5.4s

## Error

```
Error: expect(locator).toMatchAriaSnapshot(expected) failed

Snapshot: cart-summary.aria.yml

Expected:
  - complementary "Cart summary":
    - heading "Your cart" [level=2]
    - text: 2 items
    - text: Estimated delivery: 3-5 days
    - button "Checkout"

Received:
  - complementary "Cart summary":
    - heading "Your cart" [level=2]
    - text: 2 items
    - text: Arrives Oct 16 – Oct 19
    - button "Checkout"

Call log:
  - Expect "toMatchAriaSnapshot" with timeout 5000ms
  - waiting for getByTestId('cart-summary')
  - locator resolved to <aside data-testid="cart-summary">…</aside>
```

## Test source

```ts
  67 |   await page.goto('/cart?fixture=two-items');
  68 |   await page.getByLabel('Postcode').fill('12345');
  69 |   await page.getByRole('radio', { name: 'Standard' }).check();
> 70 |   await expect(page.getByTestId('cart-summary')).toMatchAriaSnapshot('cart-summary.aria.yml');
     |                                                 ^
  71 | });
```
