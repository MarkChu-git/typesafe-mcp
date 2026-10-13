import type { Invoice } from "../types.ts";

/** Read-only view of an invoice for the admin screens. */
export class InvoiceView {
  private readonly invoice: Invoice;

  constructor(invoice: Invoice) {
    this.invoice = invoice;
  }

  get reasonLabel(): string {
    return this.invoice.reason.replace("_", " ");
  }

  /** Amount followed by the currency code, such as "240.00 USD". The admin screens never show symbols. */
  formatPrice(): string {
    const amount = (this.invoice.amountCents / 100).toFixed(2);
    return `${amount} ${this.invoice.currency.toUpperCase()}`;
  }

  summary(): string {
    return `${this.invoice.id} ${this.reasonLabel} ${this.formatPrice()}`;
  }
}
