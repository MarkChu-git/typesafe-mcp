const MS_PER_DAY = 86_400_000;

export function addDays(from: Date, days: number): Date {
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function addMonths(from: Date, months: number): Date {
  const result = new Date(from);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Whole days from one instant to another, rounded up. */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** The calendar day of an instant in UTC, as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
