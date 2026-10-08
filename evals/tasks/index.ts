import type { RegisteredTask } from "./types.ts";
import triageTickets from "./triage-tickets/task.ts";
import refundGating from "./refund-gating/task.ts";
import repoFeatureFiles from "./repo-feature-files/task.ts";
import paymentLogDuplicates from "./payment-log-duplicates/task.ts";

export const ALL_TASKS: readonly RegisteredTask[] = [
  triageTickets,
  refundGating,
  repoFeatureFiles,
  paymentLogDuplicates,
];

export function findTask(id: string): RegisteredTask | undefined {
  return ALL_TASKS.find((task) => task.id === id);
}
