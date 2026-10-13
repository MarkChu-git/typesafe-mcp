import { db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import type { Address } from "../types.ts";
import { getCustomer } from "./profile.ts";

interface AddressRow {
  address: Address;
}

export async function getDefaultAddress(customerId: string): Promise<Address> {
  const result = await db.query<AddressRow>("SELECT address FROM default_addresses WHERE customer_id = $1", [
    customerId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  logger.debug({ customerId }, "default address loaded");
  return row.address;
}

export async function setDefaultAddress(customerId: string, address: Address): Promise<void> {
  const profile = await getCustomer(customerId);
  await db.query(
    `INSERT INTO default_addresses (customer_id, address) VALUES ($1, $2)
     ON CONFLICT (customer_id) DO UPDATE SET address = $2`,
    [customerId, JSON.stringify(address)],
  );

  const customer = { ...profile, address };
  logger.info({ customer }, "default address saved");
}

export async function clearDefaultAddress(customerId: string): Promise<void> {
  await db.query("DELETE FROM default_addresses WHERE customer_id = $1", [customerId]);
  logger.info({ customerId }, "default address cleared");
}
