# Test: account.spec.ts >> Account >> stays signed in after login

- Spec: e2e/account.spec.ts:30
- Browser: firefox
- Result: failed after 10.3s

## Error

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/account$/
Received string: "https://shop.example.com/login?reason=expired"
Timeout: 10000ms
```

## Call log

```
  - Expect "toHaveURL" with timeout 10000ms
  - waiting for getByRole('button', { name: 'Sign in' })
  - locator resolved to <button type="submit">Sign in</button>
  - click action done
  - navigated to "/account"
  - navigated to "/login?reason=expired"
```

## Test source

```ts
  26 |   await page.goto('/login');
  27 |   await page.getByLabel('Email').fill('shopper.7731@example.com');
  28 |   await page.getByLabel('Password').fill(accountFixture.password);
  29 |   await page.getByRole('button', { name: 'Sign in' }).click();
> 30 |   await expect(page).toHaveURL(/\/account$/);
     |                      ^
  31 | });
```

## Server log

```
[auth] POST /login 302 -> /account
[session] write failed: connect ECONNREFUSED 127.0.0.1:6379
[auth] GET /account: no session, redirecting to /login?reason=expired
```
