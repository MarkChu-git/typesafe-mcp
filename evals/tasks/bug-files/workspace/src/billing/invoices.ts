import { newId } from "../lib/ids.ts";
import type { Invoice } from "../types.ts";

const invoices: Invoice[] = [];

export type NewInvoice = Omit<Invoice, "id" | "issuedAt">;

export function createInvoice(input: NewInvoice, now: Date = new Date()): Invoice {
  const invoice: Invoice = { ...input, id: newId("inv"), issuedAt: now.toISOString() };
  invoices.push(invoice);
  return invoice;
}

export function listInvoices(customerId?: string): Invoice[] {
  if (customerId === undefined) return [...invoices];
  return invoices.filter((invoice) => invoice.customerId === customerId);
}

export function totalBilledCents(customerId: string): number {
  return listInvoices(customerId).reduce((sum, invoice) => sum + invoice.amountCents, 0);
}
