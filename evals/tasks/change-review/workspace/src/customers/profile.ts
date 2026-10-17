import { db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import type { Customer } from "../types.ts";

interface CustomerRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
  };
}

export async function getCustomer(customerId: string): Promise<Customer> {
  const result = await db.query<CustomerRow>(
    "SELECT id, email, first_name, last_name, phone FROM customers WHERE id = $1",
    [customerId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return toCustomer(row);
}

export async function changeEmail(customerId: string, email: string): Promise<void> {
  await db.query("UPDATE customers SET email = $1 WHERE id = $2", [email, customerId]);
  logger.info(`customer ${customerId} changed their email to ${email}`);
}
