# Test: account.spec.ts >> Account >> sends password reset email

- Spec: e2e/account.spec.ts:55
- Browser: firefox
- Result: failed after 20.8s

## Error

```
Error: expect(received).toMatch(expected)

Expected pattern: /reset your password/i
Received: undefined
No message reached the inbox within 20000ms.
```

## Call log

```
  - waiting for getByRole('status') to have text "Check your inbox"
  - status found
  - waiting for mail to account-1047@example.com, timeout 20000ms
  - 0 messages after 20000ms
```

## Test source

```ts
  50 |   await page.goto('/account/forgot');
  51 |   await page.getByLabel('Email').fill('account-1047@example.com');
  52 |   await page.getByRole('button', { name: 'Send reset link' }).click();
  53 |   await expect(page.getByRole('status')).toHaveText('Check your inbox');
  54 |   const mail = await waitForMail({ to: 'account-1047@example.com' }, 20_000);
> 55 |   expect(mail?.subject).toMatch(/reset your password/i);
     |                         ^
  56 | });
```

## Console

```
[auth] reset requested for account a-1047
[mailer] queued "password-reset" for account-1047@example.com
[mailer] SMTP auth failed: missing credentials
[mailer] password-reset not delivered, attempt 3 of 3
```
