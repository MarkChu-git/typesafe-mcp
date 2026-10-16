import type { RegisteredTask } from "./types.ts";
import triageTickets from "./triage-tickets/task.ts";
import refundGating from "./refund-gating/task.ts";
import repoFeatureFiles from "./repo-feature-files/task.ts";
import paymentLogDuplicates from "./payment-log-duplicates/task.ts";
import refundPromisesAudit from "./refund-promises-audit/task.ts";
import bugFiles from "./bug-files/task.ts";
import changeReview from "./change-review/task.ts";
import ciFailures from "./ci-failures/task.ts";
import incidentLogs from "./incident-logs/task.ts";
import renameCallers from "./rename-callers/task.ts";
import screenshotTriage from "./screenshot-triage/task.ts";

export const ALL_TASKS: readonly RegisteredTask[] = [
  triageTickets,
  refundGating,
  repoFeatureFiles,
  paymentLogDuplicates,
  refundPromisesAudit,
  bugFiles,
  changeReview,
  ciFailures,
  incidentLogs,
  renameCallers,
  screenshotTriage,
];

export function findTask(id: string): RegisteredTask | undefined {
  return ALL_TASKS.find((task) => task.id === id);
}
