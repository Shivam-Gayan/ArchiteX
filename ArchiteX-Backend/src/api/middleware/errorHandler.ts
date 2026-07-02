import type { Request, Response, NextFunction } from "express";
import { ErrorCode } from "../../shared/errorCodes";

/**
 * Express error-envelope builder.
 * Matches ApiContract.md §3 error envelope shape exactly.
 */
export function buildError(
  code: string,
  message: string,
  details?: { field: string; issue: string; value?: unknown }[] | null
) {
  return {
    error: {
      code,
      message,
      details: details ?? null,
    },
  };
}

/**
 * Catches Express JSON parse errors (SyntaxError) and returns the 400
 * response defined in ApiContract.md §4 Response — 400 Bad Request.
 *
 * Must be registered BEFORE routes in Express.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function jsonParseErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof SyntaxError && "body" in (err as object)) {
    res.status(400).json(
      buildError(
        ErrorCode.INVALID_JSON,
        "Request body is not valid JSON."
      )
    );
    return;
  }
  next(err);
}

/**
 * Generic 500 fallback error handler.
 * Returns ENGINE_ERROR shape from ApiContract.md §3.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error("[ArchiteX] Unhandled error:", err);
  res.status(500).json(
    buildError(
      ErrorCode.ENGINE_ERROR,
      "Rule evaluation failed unexpectedly. Please try again."
    )
  );
}
