const SYMBOLS: Record<string, string> = { usd: "$", cad: "CA$", aud: "A$" };

/** Formats an amount in minor units for display: formatPrice(24000, "usd") gives "$240.00". */
export function formatPrice(cents: number, currency: string): string {
  const code = currency.toLowerCase();
  const symbol = SYMBOLS[code];
  if (symbol === undefined) {
    console.warn("formatPrice: no symbol for currency, using the code", code);
    return `${code.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** Formats a low-to-high range such as "$9.00 - $69.00"; both ends use the single-amount format. */
export function formatPriceRange(minCents: number, maxCents: number, currency: string): string {
  const low = formatPrice(minCents, currency);
  const high = formatPrice(maxCents, currency);
  return `${low} - ${high}`;
}
