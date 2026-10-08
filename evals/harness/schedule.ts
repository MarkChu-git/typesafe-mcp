import {
  RETRYABLE_STATUSES,
  type ArmId,
  type RunKey,
  type RunRecord,
  type RunStatus,
  type StopReason,
} from "./types.ts";

/** Ordered rep → task → arm, so an early stop leaves every arm with about the same sample size. */
export function buildMatrix(tasks: readonly string[], arms: readonly ArmId[], reps: number): RunKey[] {
  const out: RunKey[] = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const task of tasks) for (const arm of arms) out.push({ task, arm, rep });
  }
  return out;
}

export const runId = (k: RunKey): string => `${k.task}__${k.arm}__${k.rep}`;

/** Keys without a final record; rate-limited and errored runs are run again. */
export function pendingRuns(matrix: readonly RunKey[], done: ReadonlyMap<string, RunStatus>): RunKey[] {
  return matrix.filter((k) => {
    const status = done.get(runId(k));
    return status === undefined || RETRYABLE_STATUSES.includes(status);
  });
}

export interface ExecuteOptions {
  runOne(key: RunKey): Promise<RunRecord>;
  maxTotalUsd: number;
  stopAtUtilization: number;
  concurrency: number;
  /** Spend already recorded in a resumed results directory. */
  spentUsd?: number;
  onRecord?(record: RunRecord): void | Promise<void>;
}

export interface ExecuteResult {
  records: RunRecord[];
  stopped: StopReason | null;
  notRun: RunKey[];
  spentUsd: number;
}

export function stopReasonFor(
  record: RunRecord,
  spentUsd: number,
  o: Pick<ExecuteOptions, "maxTotalUsd" | "stopAtUtilization">,
): StopReason | null {
  if (record.metrics.status === "rate_limited") return "rate_limited";
  const q = record.metrics.quota;
  if (q && Math.max(q.fiveHourUtilization ?? 0, q.sevenDayUtilization ?? 0) >= o.stopAtUtilization) return "quota";
  if (spentUsd >= o.maxTotalUsd) return "budget";
  return null;
}

/** Runs keys with a small worker pool; once a stop condition hits, in-flight runs finish and nothing new starts. */
export async function executeMatrix(matrix: readonly RunKey[], o: ExecuteOptions): Promise<ExecuteResult> {
  const records: RunRecord[] = [];
  let spentUsd = o.spentUsd ?? 0;
  let stopped: StopReason | null = spentUsd >= o.maxTotalUsd ? "budget" : null;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (stopped === null && next < matrix.length) {
      const key = matrix[next];
      next += 1;
      if (!key) break;
      // eslint-disable-next-line no-await-in-loop -- a worker runs its keys one after another by design
      const record = await o.runOne(key);
      records.push(record);
      spentUsd += record.metrics.costUsd;
      // eslint-disable-next-line no-await-in-loop -- records are persisted in order
      await o.onRecord?.(record);
      stopped ??= stopReasonFor(record, spentUsd, o);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.floor(o.concurrency)) }, worker));
  return { records, stopped, notRun: matrix.slice(next), spentUsd };
}
