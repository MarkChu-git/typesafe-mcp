import { totalBilledCents } from "../billing/invoices.ts";
import { t } from "../i18n/index.ts";
import type { Email, Invoice } from "../types.ts";

/** A receipt for a trial conversion says so in the subject; every other reason uses the standard one. */
function subjectFor(invoice: Invoice): string {
  return invoice.reason === "trial_conversion" ? t("receipt.subjectAfterTrial") : t("receipt.subject");
}

/** Receipt for a single invoice, sent after every charge. */
export function buildReceipt(invoice: Invoice, to: string): Email {
  const amount = `$${(invoice.amountCents / 100).toFixed(2)}`;
  const lifetime = `$${(totalBilledCents(invoice.customerId) / 100).toFixed(2)}`;
  const lines = [
    t(`receipt.${invoice.reason}`),
    `Amount charged: ${amount} (${invoice.currency.toUpperCase()}).`,
    `Billed to date: ${lifetime}.`,
  ];
  return { to, subject: subjectFor(invoice), body: lines.join(" ") };
}
