/**
 * Machine-readable error codes as defined in ApiContract.md §3 and §4.
 *
 * Used in the error envelope returned on non-2xx responses.
 */
export const ErrorCode = {
  INVALID_JSON: "INVALID_JSON",
  GRAPH_VALIDATION_FAILED: "GRAPH_VALIDATION_FAILED",
  ENGINE_ERROR: "ENGINE_ERROR",
  ENGINE_NOT_READY: "ENGINE_NOT_READY",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
