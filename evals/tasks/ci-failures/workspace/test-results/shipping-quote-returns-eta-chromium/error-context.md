# Test: shipping-quote.spec.ts >> Shipping quote >> returns eta

- Spec: e2e/api/shipping-quote.spec.ts:13
- Browser: chromium (API request)
- Result: failed after 0.3s

## Error

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received: undefined

Call log:
  - GET /api/shipping-quote?postcode=12345&method=standard
  - 200 OK, application/json
```

## Test source

```ts
   9 | test('returns eta', async ({ request }) => {
  10 |   const response = await request.get('/api/shipping-quote?postcode=12345&method=standard');
  11 |   expect(response.status()).toBe(200);
  12 |   const body = await response.json();
> 13 |   expect(body.etaDays).toBeGreaterThan(0);
     |                        ^
  14 | });
```

## Response body

```json
{
  "method": "standard",
  "price": 499,
  "deliveryWindow": { "from": "2026-10-16", "to": "2026-10-19" }
}
```
