import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { sendMail } from "../notifications/mailer.ts";

const remindersOn = process.env.CART_REMINDERS === "on";

interface AbandonedCart {
  cart_id: string;
  email: string;
  first_name: string;
}

/** Emails customers whose cart has sat untouched for a day. Returns how many were sent. */
export async function sendCartReminders(): Promise<number> {
  if (!remindersOn) return 0;

  const result = await db.query<AbandonedCart>(
    `SELECT c.id AS cart_id, u.email, u.first_name
       FROM carts c
       JOIN customers u ON u.id = c.user_id
      WHERE c.updated_at < now() - interval '1 day'
        AND c.reminded_at IS NULL`,
  );

  for (const row of result.rows) {
    await sendMail({
      to: row.email,
      subject: "You left something in your cart",
      body: `Hi ${row.first_name}, your cart is still waiting for you.`,
    });
    await db.query("UPDATE carts SET reminded_at = now() WHERE id = $1", [row.cart_id]);
  }

  logger.info({ sent: result.rows.length }, "cart reminders sent");
  return result.rows.length;
}
