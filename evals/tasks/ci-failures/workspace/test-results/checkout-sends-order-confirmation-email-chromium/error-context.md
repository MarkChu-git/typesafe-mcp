# Test: checkout.spec.ts >> Checkout >> sends order confirmation email

- Spec: e2e/checkout.spec.ts:150
- Browser: chromium
- Result: failed after 24.6s

## Error

```
Error: expect(received).not.toBeNull()

Received: null
Mailbox poll for subject "Your order 90412" gave up after 20000ms.
```

## Call log

```
  - order confirmation page reached: /orders/90412/confirmation
  - polling inbox for shopper.7731@example.com every 2000ms
  - poll 1 of 10: 0 messages
  - poll 10 of 10: 0 messages
```

## Test source

```ts
 146 |   await page.getByRole('button', { name: 'Pay now' }).click();
 147 |   await expect(page).toHaveURL(/\/orders\/.+\/confirmation/);
 148 |   const orderId = page.url().split('/').at(-2);
 149 |   const mail = await waitForMail({ to: 'shopper.7731@example.com', subject: `Your order ${orderId}` }, 20_000);
> 150 |   expect(mail).not.toBeNull();
     |                ^
 151 | });
```

## Server log

```
[checkout] order 90412 confirmed
[mailer] queued "order-confirmation" for shopper.7731@example.com
[mailer] SMTP auth failed: missing credentials
[mailer] retry 1 of 3 in 2000ms: SMTP auth failed: missing credentials
[mailer] retry 3 of 3 failed, message dropped
```
