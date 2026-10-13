/** Customer-facing text. Placeholders in braces are filled in by t(). */
export const catalogs = {
  en: {
    "cart.line": "{name} x {quantity}: {price}",
    "cart.empty": "Your cart is empty.",
    "cart.checkout_button": "Check out",
    "gift_card.applied": "Gift card applied: {amount}",
    "gift_card.balance_left": "{amount} is left on your gift card.",
    "email.order_confirmed.body":
      "Hi {name}, thank you for your order {orderId}. The total was {total}. We will write again when it ships.",
    "email.gift_card_receipt.subject": "Your gift card receipt",
    "email.gift_card_receipt.body": "Hi {name}, {amount} was taken from your gift card for order {orderId}.",
    "order.history.empty": "You have no recent orders.",
    "order.history.line": "Order {orderId}: {total}",
    "order.shipped.title": "Your order is on its way",
    "order.shipped.body": "Order {orderId} has left our warehouse.",
  },
} as const;

export type MessageKey = keyof (typeof catalogs)["en"];
