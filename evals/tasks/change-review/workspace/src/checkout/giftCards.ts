import { db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

const TABLE = "gift_cards";

interface GiftCardRow {
  code: string;
  balance_dollars: string;
  expires_at: string | null;
}

export interface Redemption {
  appliedCents: number;
  remainingCents: number;
}

async function findCard(code: string): Promise<GiftCardRow> {
  const result = await db.query<GiftCardRow>(
    `SELECT code, balance_dollars, expires_at FROM ${TABLE} WHERE code = '${code}'`,
  );
  const card = result.rows[0];
  if (!card) throw new AppError("GIFT_CARD_INVALID");
  if (card.expires_at !== null && new Date(card.expires_at) < new Date()) {
    throw new AppError("GIFT_CARD_EXPIRED");
  }
  return card;
}

/** Takes as much of the amount due as the card covers. Whatever is left stays on the card. */
export async function redeemGiftCard(code: string, amountDueCents: number): Promise<Redemption> {
  if (!Number.isInteger(amountDueCents) || amountDueCents <= 0) throw new AppError("INVALID_AMOUNT");

  const card = await findCard(code);
  const balance = Number(card.balance_dollars);
  const remaining = Math.max(balance - amountDueCents / 100, 0);
  const appliedCents = Math.min(amountDueCents, Math.round(balance * 100));

  await db.query(`UPDATE ${TABLE} SET balance_dollars = $1 WHERE code = $2`, [remaining, code]);
  logger.info({ appliedCents }, "gift card redeemed");

  return { appliedCents, remainingCents: Math.round(remaining * 100) };
}
