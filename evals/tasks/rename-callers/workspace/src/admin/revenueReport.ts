import { InvoiceView } from "../billing/invoiceView.ts";
import { listInvoices } from "../billing/invoices.ts";
import { getSubscription } from "../billing/subscriptions.ts";
import { formatPrice as fmt, formatPriceRange } from "../lib/index.ts";
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
    const monthly = fmt(row.monthlyCents, "usd");
    const yearly = fmt(row.yearlyCents, "usd");
    return `${row.period}  monthly ${monthly}  yearly ${yearly}  conversions ${row.trialConversions}`;
  });
  return ["period   monthly   yearly   conversions", ...lines].join("\n");
}

/** Smallest to largest invoice, for the header line of the report. */
export function invoiceRangeLabel(invoices: readonly Invoice[]): string {
  const amounts = invoices.map((invoice) => invoice.amountCents);
  return formatPriceRange(Math.min(...amounts), Math.max(...amounts), "usd");
}

/** One line per invoice for the admin invoice list. */
export function invoiceLines(invoices: readonly Invoice[]): string[] {
  return invoices.map((invoice) => {
    const view = new InvoiceView(invoice);
    return `${invoice.issuedAt.slice(0, 10)}  ${view.formatPrice()}  ${view.reasonLabel}`;
  });
}
