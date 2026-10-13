# Test: store-locator.spec.ts >> Store locator >> shows a pin for each store

- Spec: e2e/store-locator.spec.ts:19
- Browser: firefox
- Result: failed after 30.4s

## Error

```
Error: expect(locator).toHaveCount(expected) failed

Locator: locator('.map-pin')
Expected: 12
Received: 0
Timeout: 30000ms

Call log:
  - Expect "toHaveCount" with timeout 30000ms
  - waiting for locator('.map-pin')
    - locator resolved to 0 elements
```

## Test source

```ts
  15 |   await page.goto('/stores');
  16 |   await page.getByLabel('Postcode').fill('12345');
  17 |   await page.getByRole('button', { name: 'Search' }).click();
  18 |   await expect(page.getByRole('region', { name: 'Store map' })).toBeVisible();
> 19 |   await expect(page.locator('.map-pin')).toHaveCount(12);
     |                                         ^
  20 | });
```

## Console

```
[map] tile https://tiles.maps.example/v3/12/2104/1361.png 503 Service Unavailable, retry 1 of 3
[map] tile https://tiles.maps.example/v3/12/2104/1362.png 503 Service Unavailable, retry 2 of 3
[map] tile https://tiles.maps.example/v3/12/2105/1361.png 200 OK
[map] tile https://tiles.maps.example/v3/12/2104/1362.png 503 Service Unavailable, retry 3 of 3
[map] load event pending: 1 tile outstanding after 30s
```

## Page snapshot

```yaml
- heading "Find a store" [level=1]
- textbox "Postcode": "12345"
- button "Search"
- region "Store map":
  - img "Map loading"
- text: Showing 12 stores in this area
```
