import type { TermMonths } from "../types.ts";

// Cadence labels as they appear in rows exported from the old billing system.
const MONTHS_BY_LABEL: Record<string, TermMonths> = {
  monthly: 1,
  "1m": 1,
  annual: 12,
  "12m": 12,
};

const FALLBACK_TERM_MONTHS: TermMonths = 1;

/** Number of months one term covers for a cadence label. Unknown labels count as one month. */
export function termMonthsForCadence(cadence: string): TermMonths {
  return MONTHS_BY_LABEL[cadence.toLowerCase()] ?? FALLBACK_TERM_MONTHS;
}

/** The label used in exports and log lines for a term length. */
export function cadenceLabelForTerm(termMonths: TermMonths): string {
  return termMonths === 12 ? "annual" : "monthly";
}
