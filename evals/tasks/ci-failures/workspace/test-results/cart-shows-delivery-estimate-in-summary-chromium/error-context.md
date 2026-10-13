# Test: cart.spec.ts >> Cart >> shows delivery estimate in summary

- Spec: e2e/cart.spec.ts:33
- Browser: chromium
- Result: failed after 5.2s

## Error

```
Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('cart-summary').getByTestId('delivery-estimate')
Expected pattern: /Arrives \w{3} \d{1,2} – \w{3} \d{1,2}/
Received string: "Arrives Invalid Date – Invalid Date"
Timeout: 5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for getByTestId('cart-summary').getByTestId('delivery-estimate')
  - locator resolved to <p data-testid="delivery-estimate">Arrives Invalid Date – Invalid Date</p>
```

## Server log

```
[shipping] GET /api/shipping-quote?postcode=12345&method=standard 200 58ms
[shipping] body {"method":"standard","price":499,"deliveryWindow":{"from":"2026-10-16","to":"2026-10-19"}}
```

## Page snapshot

```yaml
- complementary "Cart summary":
  - heading "Your cart" [level=2]
  - text: 2 items
  - text: Subtotal $38.00
  - text: Shipping $4.99
  - text: Arrives Invalid Date – Invalid Date
  - button "Checkout"
```
