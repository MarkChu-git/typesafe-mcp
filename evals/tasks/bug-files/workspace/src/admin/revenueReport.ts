import { listInvoices } from "../billing/invoices.ts";
import { getSubscription } from "../billing/subscriptions.ts";
import type { Invoice } from "../types.ts";

export interface RevenueRow {
  /** Calendar month of the invoices, as YYYY-MM. */
  period: string;
  monthlyCents: number;
  yearlyCents: number;
  trialConversions: number;
}

/** Revenue per month, split by billing interval: monthly or yearly terms. */
export function buildRevenueReport(invoices: readonly Invoice[] = listInvoices()): RevenueRow[] {
  const rows = new Map<string, RevenueRow>();
  for (const invoice of invoices) {
    const period = invoice.issuedAt.slice(0, 7);
    const row = rows.get(period) ?? { period, monthlyCents: 0, yearlyCents: 0, trialConversions: 0 };
    if (getSubscription(invoice.subscriptionId).termMonths === 12) {
      row.yearlyCents += invoice.amountCents;
    } else {
      row.monthlyCents += invoice.amountCents;
    }
    if (invoice.reason === "trial_conversion") row.trialConversions += 1;
    rows.set(period, row);
  }
  return [...rows.values()].toSorted((a, b) => a.period.localeCompare(b.period));
}

/** Annual run rate: every invoice scaled to twelve months of revenue. */
export function annualizedRunRateCents(invoices: readonly Invoice[] = listInvoices()): number {
  return invoices.reduce((sum, invoice) => {
    const termMonths = getSubscription(invoice.subscriptionId).termMonths;
    return sum + Math.round(invoice.amountCents * (12 / termMonths));
  }, 0);
}

export function renderReport(rows: readonly RevenueRow[]): string {
  const lines = rows.map((row) => {
    const monthly = (row.monthlyCents / 100).toFixed(2);
    const yearly = (row.yearlyCents / 100).toFixed(2);
    return `${row.period}  monthly ${monthly}  yearly ${yearly}  conversions ${row.trialConversions}`;
  });
  return ["period   monthly   yearly   conversions", ...lines].join("\n");
}
