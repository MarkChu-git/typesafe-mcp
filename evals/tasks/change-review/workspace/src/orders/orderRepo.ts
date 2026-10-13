import { db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import type { Order, OrderStatus } from "../types.ts";

const TABLE = "orders";

interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  subtotal_cents: number;
  tax_cents: number;
  gift_card_cents: number;
  total_cents: number;
  placed_at: string;
}

export interface NewOrder {
  id: string;
  customerId: string;
  subtotalCents: number;
  taxCents: number;
  giftCardCents: number;
  totalCents: number;
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    giftCardCents: row.gift_card_cents,
    totalCents: row.total_cents,
    placedAt: row.placed_at,
  };
}

export async function insertOrder(order: NewOrder): Promise<Order> {
  const result = await db.query<OrderRow>(
    `INSERT INTO ${TABLE}
       (id, customer_id, status, subtotal_cents, tax_cents, gift_card_cents, total_cents, placed_at)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, now())
     RETURNING id, customer_id, status, subtotal_cents, tax_cents, gift_card_cents, total_cents, placed_at`,
    [order.id, order.customerId, order.subtotalCents, order.taxCents, order.giftCardCents, order.totalCents],
  );
  const row = result.rows[0];
  if (!row) throw new AppError("INTERNAL");
  return toOrder(row);
}

export async function findOrder(id: string): Promise<Order | null> {
  const result = await db.query<OrderRow>(
    `SELECT id, customer_id, status, subtotal_cents, tax_cents, gift_card_cents, total_cents, placed_at
       FROM ${TABLE}
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toOrder(row) : null;
}

export async function markPaid(id: string, chargeId: string | null): Promise<void> {
  await db.query(`UPDATE ${TABLE} SET status = 'paid', charge_id = $2 WHERE id = $1`, [id, chargeId]);
}
