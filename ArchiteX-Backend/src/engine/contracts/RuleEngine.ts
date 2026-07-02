import type { GraphContext } from "../../graph/contracts/GraphContext";
import type { SeverityLevel } from "../../shared/severity";

/**
 * A single rule violation produced by the engine.
 * Matches ViolationObject in ApiContract.md §2 exactly.
 */
export interface Violation {
  ruleName: string;
  severity: SeverityLevel;
  message: string;
  highlightedNodeIds: string[];
  ruleFile: string;
}

/**
 * Metadata about a loaded rule.
 * Matches the rule shape in GET /rules response (ApiContract.md §7).
 */
export interface RuleMetadata {
  name: string;
  severity: SeverityLevel;
  category: string;
  file: string;
  yieldMessage: string;
  hasSimulation: boolean;
}

/**
 * Options passed from the API layer to the engine per validate request.
 * Derived from ApiContract.md §4 request body (ruleFilter + simulation).
 */
export interface EvaluationOptions {
  /**
   * Simulation variable overrides from the frontend.
   * ApiContract §4: "simulation values must be numbers"
   * null means no simulation overrides — rules use their own SIMULATE defaults.
   */
  simulationOverrides: Record<string, number> | null;

  /**
   * If set, only rules matching these categories are evaluated.
   * null means all categories (run all rules).
   */
  categories: string[] | null;

  /**
   * Rule names to explicitly skip.
   * null means no exclusions.
   */
  excludeRules: string[] | null;
}

/**
 * RuleEngine — the ONLY interface through which the backend interacts
 * with the compiler's evaluation logic.
 *
 * Dev C implements this. Dev A depends only on this interface.
 * The backend must never import AST, Lexer, Parser, or Semantic types.
 *
 * Lifecycle:
 * 1. Backend calls loadRules() at startup.
 * 2. Backend calls getLoadedRules() to serve GET /rules.
 * 3. Backend calls evaluate() per POST /validate request.
 */
export interface RuleEngine {
  /**
   * Load and compile all .arch rule files.
   * Must be called before evaluate().
   * Throws if a file cannot be parsed or semantics are invalid.
   * ApiContract §8: engine readiness — /health reflects this state.
   */
  loadRules(filePaths: string[]): Promise<void>;

  /**
   * Returns all successfully loaded rule metadata.
   * Used to serve GET /rules with optional filtering.
   */
  getLoadedRules(): RuleMetadata[];

  /**
   * Evaluates all applicable rules against the graph.
   *
   * - Violations are NOT errors — a graph with 20 violations returns normally.
   *   (ApiContract §1: "Validation violations are not HTTP errors.")
   * - If the engine has not been loaded, throws an EngineNotReadyError.
   */
  evaluate(
    graph: GraphContext,
    options: EvaluationOptions
  ): Violation[];

  /**
   * Returns true once loadRules() has completed successfully.
   * Used by GET /health to reflect engine readiness.
   */
  isReady(): boolean;
}
