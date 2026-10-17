import { getDefaultAddress } from "../customers/addressBook.ts";
import { getCustomer } from "../customers/profile.ts";
import { AppError } from "../lib/errors.ts";
import { flags } from "../lib/flags.ts";
import { logger } from "../lib/logger.ts";
import { sendGiftCardReceipt, sendOrderConfirmation } from "../notifications/orderEmail.ts";
import { insertOrder, markPaid } from "../orders/orderRepo.ts";
import { chargeSavedMethod } from "../payments/gateway.ts";
import { quoteExpress } from "../pricing/tax.ts";
import { assertNotEmpty, loadCart, subtotalCents } from "./cart.ts";
import { redeemGiftCard } from "./giftCards.ts";

const enabled = process.env.EXPRESS_CHECKOUT === "1";

export interface ExpressRequest {
  userId: string;
  cartId: string;
  giftCardCode?: string;
}

export interface ExpressResult {
  orderId: string;
  totalCents: number;
  /** What the confirmation screen shows once the order is placed. */
  message: string;
}

async function applyGiftCard(code: string | undefined, amountDueCents: number): Promise<number> {
  if (!code || !flags.isOn("gift_cards")) return 0;
  const redemption = await redeemGiftCard(code, amountDueCents);
  return redemption.appliedCents;
}

export async function expressCheckout(request: ExpressRequest): Promise<ExpressResult> {
  if (!enabled) throw new AppError("FEATURE_DISABLED");

  const cart = await loadCart(request.cartId);
  assertNotEmpty(cart);

  const address = await getDefaultAddress(request.userId);
  const quote = quoteExpress(subtotalCents(cart), address);
  const giftCardCents = await applyGiftCard(request.giftCardCode, quote.totalCents);
  const dueCents = quote.totalCents - giftCardCents;

  const order = await insertOrder({
    id: `ord_${Date.now()}`,
    customerId: request.userId,
    subtotalCents: quote.subtotalCents,
    taxCents: quote.taxCents,
    giftCardCents,
    totalCents: quote.totalCents,
  });

  const charge = dueCents > 0 ? await chargeSavedMethod(order.id, request.userId, dueCents) : null;
  await markPaid(order.id, charge ? charge.chargeId : null);

  const customer = await getCustomer(request.userId);
  await sendOrderConfirmation(order, customer);
  await sendGiftCardReceipt(order, customer);
  logger.info({ orderId: order.id, userId: request.userId, chargedCents: dueCents }, "express order placed");

  return {
    orderId: order.id,
    totalCents: order.totalCents,
    message: `Thanks! Order ${order.id} is placed and we will email you when it ships.`,
  };
}
