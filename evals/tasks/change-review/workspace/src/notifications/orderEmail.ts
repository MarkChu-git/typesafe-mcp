import { t } from "../lib/i18n.ts";
import { logger } from "../lib/logger.ts";
import type { Customer, Order } from "../types.ts";
import { sendMail } from "./mailer.ts";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function sendOrderConfirmation(order: Order, customer: Customer): Promise<void> {
  const subject = `Your order ${order.id} is confirmed`;
  const body = t("email.order_confirmed.body", {
    name: customer.firstName,
    orderId: order.id,
    total: money(order.totalCents),
  });

  await sendMail({ to: customer.email, subject, body });
  logger.info({ orderId: order.id, customerId: customer.id }, "order confirmation sent");
}

/** Sent when a gift card paid for all or part of an order. */
export async function sendGiftCardReceipt(order: Order, customer: Customer): Promise<void> {
  if (order.giftCardCents === 0) return;

  await sendMail({
    to: customer.email,
    subject: t("email.gift_card_receipt.subject"),
    body: t("email.gift_card_receipt.body", {
      name: customer.firstName,
      amount: money(order.giftCardCents),
      orderId: order.id,
    }),
  });
  logger.info({ orderId: order.id }, "gift card receipt sent");
}
