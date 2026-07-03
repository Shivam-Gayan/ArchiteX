/**
 * Semantic diagnostic codes — produced by the SemanticAnalyser.
 *
 * All codes and messages are derived from ArchQL_v3_2.md §20.
 * Do not add checks that are not in the spec.
 */

export const enum SemanticDiagnosticCode {
  /** All variables in WHERE must be bound in MATCH or OPTIONAL */
  UNBOUND_VARIABLE_WHERE       = "S001",

  /** All variables in YIELD WITH must be bound */
  UNBOUND_VARIABLE_YIELD       = "S002",

  /** BY anchor must be bound in MATCH, not OPTIONAL */
  BY_ANCHOR_NOT_IN_MATCH       = "S003",

  /** DEGREE argument must be a bound alias */
  DEGREE_UNBOUND_ARGUMENT      = "S004",

  /** EXISTS path endpoints that are aliases must be bound */
  EXISTS_ENDPOINT_UNBOUND      = "S005",

  /** SIMULATE variable must not shadow a bound node/edge alias */
  SIMULATE_SHADOWS_ALIAS       = "S006",

  /** Rule name must be unique across all loaded .arch files */
  DUPLICATE_RULE_NAME          = "S007",

  /**
   * SUM / AVG / MIN / MAX must be called with a property accessor:
   *   SUM(var.prop)  not  SUM(var)
   */
  AGGREGATE_MISSING_PROPERTY   = "S008",
}

export interface SemanticDiagnostic {
  readonly code: SemanticDiagnosticCode;
  readonly message: string;
  readonly ruleName: string;
  readonly line: number;
  readonly column: number;
}
