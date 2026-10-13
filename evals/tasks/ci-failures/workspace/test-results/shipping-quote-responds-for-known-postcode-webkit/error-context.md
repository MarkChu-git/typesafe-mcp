# Test: shipping-quote.spec.ts >> Shipping quote >> responds for known postcode

- Spec: e2e/api/shipping-quote.spec.ts:39
- Browser: webkit (API request)
- Result: failed after 0.4s

## Error

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 500
```

## Call log

```
  - GET /api/shipping-quote?postcode=12345&method=standard
  - 500 Internal Server Error, application/json
```

## Test source

```ts
  36 | test('responds for known postcode', async ({ request }) => {
  37 |   const url = '/api/shipping-quote?postcode=12345&method=standard';
  38 |   const response = await request.get(url);
> 39 |   expect(response.status()).toBe(200);
     |                             ^
  40 | });
```

## Server log

```
[shipping] quote request postcode=12345 method=standard
[shipping] rate cache read failed: connect ECONNREFUSED 127.0.0.1:6379
[shipping] 500 internal error (rate cache unavailable)
```
