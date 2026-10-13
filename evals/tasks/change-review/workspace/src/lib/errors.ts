export type ErrorCode =
  | "FEATURE_DISABLED"
  | "NOT_FOUND"
  | "CART_EMPTY"
  | "GIFT_CARD_INVALID"
  | "GIFT_CARD_EXPIRED"
  | "INVALID_AMOUNT"
  | "PAYMENT_FAILED"
  | "EMAIL_FAILED"
  | "INTERNAL";

export interface AppErrorOptions {
  cause?: unknown;
  details?: Readonly<Record<string, unknown>>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

type ErrorContext = Readonly<Record<string, unknown>>;
type ErrorSink = (err: unknown, context: ErrorContext) => void;

let sink: ErrorSink | undefined;

export function setErrorSink(next: ErrorSink): void {
  sink = next;
}

/** Hands the error to the error tracker, which alerts the on-call engineer. */
export function reportError(err: unknown, context: ErrorContext = {}): void {
  sink?.(err, context);
}
