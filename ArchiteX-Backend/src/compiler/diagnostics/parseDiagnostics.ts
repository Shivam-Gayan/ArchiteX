/**
 * Parser diagnostic codes and types.
 *
 * Diagnostics are non-fatal by default — the parser continues
 * after an error to discover more issues. A rule is only discarded
 * if the error makes it impossible to build a valid RuleNode.
 */

export const enum ParseDiagnosticCode {
  // Structure errors
  EXPECTED_TOKEN          = "P001",
  UNEXPECTED_TOKEN        = "P002",
  MISSING_CLAUSE          = "P003",
  WRONG_CLAUSE_ORDER      = "P004",

  // Literal errors
  INVALID_SEVERITY        = "P005",
  INVALID_SIMULATE_VALUE  = "P006",

  // Pattern errors
  INVALID_NODE_PATTERN    = "P007",
  INVALID_EDGE_PATTERN    = "P008",
  INVALID_PATH_DEPTH      = "P009",

  // Expression errors
  INVALID_EXPRESSION      = "P010",
}

export interface ParseDiagnostic {
  readonly code: ParseDiagnosticCode;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}
