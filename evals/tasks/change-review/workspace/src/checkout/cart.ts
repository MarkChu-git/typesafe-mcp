import { db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { t } from "../lib/i18n.ts";
import { logger } from "../lib/logger.ts";

export interface CartLine {
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Cart {
  id: string;
  userId: string;
  lines: CartLine[];
}

interface CartRow {
  id: string;
  user_id: string;
  lines: CartLine[];
}

export async function loadCart(cartId: string): Promise<Cart> {
  const result = await db.query<CartRow>("SELECT id, user_id, lines FROM carts WHERE id = $1", [cartId]);
  const row = result.rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return { id: row.id, userId: row.user_id, lines: row.lines };
}

export function lineCents(line: CartLine): number {
  return line.unitPriceCents * line.quantity;
}

export function subtotalCents(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + lineCents(line), 0);
}

export function assertNotEmpty(cart: Cart): void {
  if (cart.lines.length === 0) throw new AppError("CART_EMPTY");
}

/** One line of the cart summary, as the customer reads it. */
export function describeLine(line: CartLine): string {
  return t("cart.line", {
    name: line.name,
    quantity: line.quantity,
    price: `$${(lineCents(line) / 100).toFixed(2)}`,
  });
}

export async function removeLine(cart: Cart, sku: string): Promise<Cart> {
  const lines = cart.lines.filter((line) => line.sku !== sku);
  await db.query("UPDATE carts SET lines = $1, updated_at = now() WHERE id = $2", [JSON.stringify(lines), cart.id]);
  logger.info({ userId: cart.userId, cartId: cart.id, sku }, "cart line removed");
  return { ...cart, lines };
}
