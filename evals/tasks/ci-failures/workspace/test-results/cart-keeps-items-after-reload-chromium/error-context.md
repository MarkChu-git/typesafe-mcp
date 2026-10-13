# Test: cart.spec.ts >> Cart >> keeps items after a reload

- Spec: e2e/cart.spec.ts:13
- Browser: chromium
- Result: failed after 1.1s

## Error

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 500
```

## Call log

```
  - GET /api/cart through page.request, same session as the page
  - 500 Internal Server Error, application/json
```

## Test source

```ts
   9 |   await page.goto('/products/linen-throw');
  10 |   await page.getByRole('button', { name: 'Add to cart' }).click();
  11 |   await page.reload();
  12 |   const response = await page.request.get('/api/cart');
> 13 |   expect(response.status()).toBe(200);
     |                             ^
  14 | });
```

## Server log

```
[cart] GET /api/cart session=anon-77c2 500 12ms
[session] lookup failed: connect ECONNREFUSED 127.0.0.1:6379
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1636:16)
```
