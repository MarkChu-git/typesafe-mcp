import type { Trial } from "../types.ts";

const trials = new Map<string, Trial>();

export function saveTrial(trial: Trial): void {
  trials.set(trial.id, trial);
}

export function getTrial(id: string): Trial {
  const trial = trials.get(id);
  if (!trial) throw new Error(`Unknown trial ${id}`);
  return trial;
}

export function hasHadTrial(customerId: string): boolean {
  return [...trials.values()].some((trial) => trial.customerId === customerId);
}

/** Trials that have run out and are still waiting to be converted. */
export function listTrialsEndingBy(nowIso: string): Trial[] {
  return [...trials.values()].filter((trial) => !trial.convertedAt && trial.endsAt <= nowIso);
}

/** Open trials whose end falls after `fromIso` and up to `toIso`. */
export function listTrialsEndingBetween(fromIso: string, toIso: string): Trial[] {
  return [...trials.values()].filter(
    (trial) => !trial.convertedAt && trial.endsAt > fromIso && trial.endsAt <= toIso,
  );
}

export function markTrialConverted(id: string, at: string): void {
  trials.set(id, { ...getTrial(id), convertedAt: at });
}
