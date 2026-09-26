/** Machine-readable reasons used when routing degrades to its safe fallback. */
export const ROUTER_ERROR_REASONS = [
  "backend_unavailable",
  "timeout",
  "malformed_response",
  "invalid_probabilities",
  "invalid_configuration",
  "input_truncated",
] as const;

export type RouterErrorReason = (typeof ROUTER_ERROR_REASONS)[number];

/**
 * Expected operational errors from the router.
 *
 * The reason is deliberately stable so the CLI can keep JSON output
 * machine-readable without exposing backend response bodies or stack traces.
 */
export class RouterError extends Error {
  readonly reason: RouterErrorReason;
  readonly code: RouterErrorReason;

  constructor(reason: RouterErrorReason, message: string) {
    super(message);
    this.name = "RouterError";
    this.reason = reason;
    this.code = reason;
  }
}

export function isRouterError(error: unknown): error is RouterError {
  return error instanceof RouterError;
}

/** Only typed operational router errors are eligible for backend fallback. */
export const isExpectedBackendError = isRouterError;
