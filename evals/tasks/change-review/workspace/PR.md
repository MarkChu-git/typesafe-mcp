# PR #482: Express checkout and gift cards

The checkout team opened this from `feature/express-checkout` against `main`.

## Summary

Adds one-tap express checkout for returning customers and lets customers pay for an order, fully or partly, with a gift card.

- Express checkout charges the saved payment method and prices the order for the customer's default address. It stays off until it is enabled.
- Gift card redemption is behind the `gift_cards` flag, both on its own endpoint and inside express checkout. Whatever balance is left stays on the card.
- The express screen gets a tax-inclusive quote for the customer's region, a summary of the cart and the customer's most recent orders.
- A confirmation email goes out after an express order, plus a receipt when a gift card covered part of it.
- Orders now store how much of the total a gift card covered, and the address book can save and clear a default address. The screens for it follow in a later PR.

## Testing

Placed express orders on staging with seeded carts, with and without a gift card, and checked both emails in the staging inbox.

## Files changed

- `src/checkout/cart.ts`
- `src/checkout/expressCheckout.ts` (new)
- `src/checkout/giftCards.ts` (new)
- `src/customers/addressBook.ts`
- `src/notifications/orderEmail.ts`
- `src/orders/orderHistory.ts`
- `src/orders/orderRepo.ts`
- `src/payments/gateway.ts`
- `src/pricing/tax.ts`
- `src/server.ts`
