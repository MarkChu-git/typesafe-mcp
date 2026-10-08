import { database } from "../db/database.ts";
import type { Order } from "../types/index.ts";

export async function createOrder(customerId: string, items: unknown[]): Promise<Order> {
  const orderId = `ord_${Date.now()}`;

  await database.query("INSERT INTO orders (id, customer_id, status) VALUES ($1, $2, $3)", [
    orderId,
    customerId,
    "pending",
  ]);

  return { id: orderId, customerId, status: "pending" };
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const result = await database.query("SELECT * FROM orders WHERE id = $1", [orderId]);
  return result.rows[0] || null;
}
