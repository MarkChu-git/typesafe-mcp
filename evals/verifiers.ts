import * as path from "node:path";

export function normLabel(s: string): string {
  return s.trim().toLowerCase();
}

export function normPath(p: string): string {
  let normalized = p.replace(/\\/g, "/");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^\//, "");
  normalized = path.posix.normalize(normalized);
  normalized = normalized.replace(/\/$/, "");
  return normalized;
}

export function exactMatch(pred: string, gold: string): number {
  return normLabel(pred) === normLabel(gold) ? 1 : 0;
}

export interface SetF1Result {
  precision: number;
  recall: number;
  f1: number;
}

export function setF1(
  pred: readonly string[],
  gold: readonly string[],
  norm: (s: string) => string = normLabel,
): SetF1Result {
  if (gold.length === 0 && pred.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }

  const predSet = new Set(pred.map(norm));
  const goldSet = new Set(gold.map(norm));

  const intersection = [...predSet].filter((item) => goldSet.has(item)).length;

  const precision = predSet.size === 0 ? 0 : intersection / predSet.size;
  const recall = goldSet.size === 0 ? 0 : intersection / goldSet.size;

  if (precision + recall === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const f1 = (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function itemAccuracy<T>(
  pred: Readonly<Record<string, T>>,
  gold: Readonly<Record<string, T>>,
  eq?: (a: T, b: T) => boolean,
): number {
  if (Object.keys(gold).length === 0) {
    return 1;
  }

  const defaultEq = (a: T, b: T): boolean => {
    if (typeof a === "string" && typeof b === "string") {
      return normLabel(a as string) === normLabel(b as string);
    }
    return a === b;
  };

  const compareFn = eq || defaultEq;
  let correctCount = 0;

  for (const key of Object.keys(gold)) {
    const predValue = pred[key];
    const goldValue = gold[key]!;
    if (predValue !== undefined && compareFn(predValue, goldValue)) {
      correctCount++;
    }
  }

  return correctCount / Object.keys(gold).length;
}

export function weightedCost(
  pred: Readonly<Record<string, string>>,
  gold: Readonly<Record<string, string>>,
  cost: Readonly<Record<string, Readonly<Record<string, number>>>>,
): number {
  if (Object.keys(gold).length === 0) {
    return 1;
  }

  let actual = 0;
  let worst = 0;

  for (const goldKey of Object.keys(gold)) {
    const goldValue = gold[goldKey]!;
    const predValue = pred[goldKey];
    const normalizedGoldValue = normLabel(goldValue);
    const normalizedPredValue = predValue ? normLabel(predValue) : "";

    const goldCostTable = cost[normalizedGoldValue];
    if (!goldCostTable) {
      continue;
    }

    if (normalizedGoldValue === normalizedPredValue) {
      actual += 0;
    } else if (normalizedPredValue && normalizedPredValue in goldCostTable) {
      actual += goldCostTable[normalizedPredValue]!;
    } else {
      const values = Object.values(goldCostTable);
      actual += values.length > 0 ? Math.max(...values) : 0;
    }

    const values = Object.values(goldCostTable);
    worst += values.length > 0 ? Math.max(...values) : 0;
  }

  if (worst === 0) {
    return 1;
  }

  return 1 - actual / worst;
}
