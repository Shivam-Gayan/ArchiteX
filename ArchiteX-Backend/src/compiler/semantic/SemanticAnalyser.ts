/**
 * ArchQL Semantic Analyser — §20
 *
 * Validates a batch of parsed RuleNode[]s before they are handed to the
 * matcher/evaluator. Produces SemanticDiagnostic[] — one per failed check.
 *
 * Rules that fail any check are excluded from the valid output list so the
 * engine never attempts to evaluate a semantically broken rule.
 *
 * Responsibilities (§20):
 *  S001 — All identifiers in WHERE are bound in MATCH or OPTIONAL
 *  S002 — All variables in YIELD WITH are bound in MATCH or OPTIONAL
 *  S003 — BY anchor must be bound in MATCH specifically (not OPTIONAL)
 *  S004 — DEGREE argument must be a bound alias
 *  S005 — EXISTS path aliases must be previously bound
 *  S006 — SIMULATE variables must not shadow bound node/edge aliases
 *  S007 — Rule names must be unique across all loaded .arch files
 *  S008 — SUM/AVG/MIN/MAX require a property accessor (var.prop)
 *
 * What this analyser does NOT own:
 *  - Type inference / graph type checking (done at match time)
 *  - SIMULATE value resolution (done by evaluator)
 *  - Path depth validation (done by parser)
 */

import type {
  RuleNode,
  PatternNode,
  NodePatternNode,
  EdgePatternNode,
  BooleanExpr,
  Expression,
  ExistsExprNode,
  FunctionCallNode,
  ComparisonExpr,
  NotExpr,
  AndExpr,
  OrExpr,
} from "../ast/RuleAST";
import {
  SemanticDiagnosticCode,
  type SemanticDiagnostic,
} from "../diagnostics/semanticDiagnostics";

export interface SemanticAnalysisResult {
  /** Rules that passed all checks and are safe to evaluate */
  validRules: RuleNode[];
  diagnostics: SemanticDiagnostic[];
}

// ---------------------------------------------------------------------------
// Binding sets
// ---------------------------------------------------------------------------

interface BindingSets {
  /** Variables bound in the MATCH clause — safe to use as BY anchors */
  matchBound: Set<string>;
  /** Variables bound in any OPTIONAL clause — can be null at runtime */
  optionalBound: Set<string>;
  /** Union of matchBound + optionalBound — all referenceable aliases */
  allBound: Set<string>;
  /** SIMULATE variable names */
  simVars: Set<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SemanticAnalyser {
  /**
   * Analyses all rules in the batch.
   *
   * @param rules  Parsed RuleNode[] from the Parser.
   * @param sourceFile  The .arch filename (used in diagnostics).
   */
  analyse(rules: RuleNode[], sourceFile: string = "<unknown>"): SemanticAnalysisResult {
    const diagnostics: SemanticDiagnostic[] = [];
    const validRules: RuleNode[] = [];

    // S007 — Collect all rule names for duplicate detection across the batch
    const seenNames = new Map<string, RuleNode>();

    for (const rule of rules) {
      // S007: duplicate name check
      if (seenNames.has(rule.name)) {
        diagnostics.push(this.diag(
          SemanticDiagnosticCode.DUPLICATE_RULE_NAME,
          `Duplicate rule name: '${rule.name}'`,
          rule.name,
          rule.line,
          rule.column,
        ));
        // The second occurrence is the invalid one — skip it
        continue;
      }
      seenNames.set(rule.name, rule);

      const ruleDiags = this.analyseRule(rule);
      diagnostics.push(...ruleDiags);

      // Only add to validRules if no errors were found for this rule
      if (ruleDiags.length === 0) {
        validRules.push(rule);
      }
    }

    return { validRules, diagnostics };
  }

  // ---------------------------------------------------------------------------
  // Per-rule analysis
  // ---------------------------------------------------------------------------

  private analyseRule(rule: RuleNode): SemanticDiagnostic[] {
    const diags: SemanticDiagnostic[] = [];

    // Collect binding sets
    const matchBound   = this.collectAliasesFromPattern(rule.matchClause);
    const optionalBound = new Set<string>();
    for (const opt of rule.optionalClauses) {
      for (const alias of this.collectAliasesFromPattern(opt)) {
        optionalBound.add(alias);
      }
    }
    const allBound = new Set([...matchBound, ...optionalBound]);
    const simVars  = new Set(rule.simulateBindings.map((b) => b.variable));

    const bindings: BindingSets = { matchBound, optionalBound, allBound, simVars };

    // S006 — SIMULATE variables must not shadow bound aliases
    for (const binding of rule.simulateBindings) {
      if (allBound.has(binding.variable)) {
        diags.push(this.diag(
          SemanticDiagnosticCode.SIMULATE_SHADOWS_ALIAS,
          `SIMULATE variable '${binding.variable}' conflicts with bound alias`,
          rule.name, rule.line, rule.column,
        ));
      }
    }

    // S001 — Check WHERE clause
    if (rule.whereClause) {
      this.checkBooleanExpr(rule.whereClause, bindings, rule, diags);
    }

    // S002 — Check YIELD WITH variables
    for (const v of rule.yieldClause.withVars) {
      if (!allBound.has(v)) {
        diags.push(this.diag(
          SemanticDiagnosticCode.UNBOUND_VARIABLE_YIELD,
          `Unbound variable '${v}' in YIELD WITH`,
          rule.name, rule.line, rule.column,
        ));
      }
    }

    return diags;
  }

  // ---------------------------------------------------------------------------
  // Collect bound aliases from a PatternNode
  //
  // A PatternNode is a sequence of NodePatternNode and EdgePatternNode.
  // We collect aliases from both node and edge patterns.
  // Anonymous nodes/edges (alias = null) bind nothing.
  // ---------------------------------------------------------------------------

  private collectAliasesFromPattern(pattern: PatternNode): Set<string> {
    const aliases = new Set<string>();
    for (const el of pattern.elements) {
      if (el.alias !== null) {
        aliases.add(el.alias);
      }
    }
    return aliases;
  }

  // ---------------------------------------------------------------------------
  // Walk a BooleanExpr and validate all variable references
  // ---------------------------------------------------------------------------

  private checkBooleanExpr(
    expr: BooleanExpr,
    bindings: BindingSets,
    rule: RuleNode,
    diags: SemanticDiagnostic[],
  ): void {
    switch (expr.kind) {
      case "And":
        this.checkBooleanExpr((expr as AndExpr).left, bindings, rule, diags);
        this.checkBooleanExpr((expr as AndExpr).right, bindings, rule, diags);
        break;

      case "Or":
        this.checkBooleanExpr((expr as OrExpr).left, bindings, rule, diags);
        this.checkBooleanExpr((expr as OrExpr).right, bindings, rule, diags);
        break;

      case "Not":
        this.checkBooleanExpr((expr as NotExpr).operand, bindings, rule, diags);
        break;

      case "ExistsExpr":
        this.checkExistsExpr(expr as ExistsExprNode, bindings, rule, diags);
        break;

      case "Comparison":
        this.checkComparison(expr as ComparisonExpr, bindings, rule, diags);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // EXISTS checks — S005
  // ---------------------------------------------------------------------------

  private checkExistsExpr(
    expr: ExistsExprNode,
    bindings: BindingSets,
    rule: RuleNode,
    diags: SemanticDiagnostic[],
  ): void {
    switch (expr.form) {
      case "variable":
        // EXISTS(auth) — variable must be bound (OPTIONAL-bound is fine, that's the whole point)
        if (expr.variable && !bindings.allBound.has(expr.variable)) {
          diags.push(this.diag(
            SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE,
            `Unbound variable '${expr.variable}' in WHERE clause`,
            rule.name, rule.line, rule.column,
          ));
        }
        break;

      case "property":
        // EXISTS(srv.cpu) — the root variable must be bound
        if (expr.variable && !bindings.allBound.has(expr.variable)) {
          diags.push(this.diag(
            SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE,
            `Unbound variable '${expr.variable}' in WHERE clause`,
            rule.name, rule.line, rule.column,
          ));
        }
        break;

      case "path":
        // EXISTS((from) -> (to)) — any non-null alias used in the path
        // must already be bound. Anonymous nodes (:Type) need not be bound.
        if (expr.path) {
          this.checkExistsEndpoint(expr.path.from, bindings, rule, diags);
          if (expr.path.to) {
            this.checkExistsEndpoint(expr.path.to, bindings, rule, diags);
          }
        }
        break;
    }
  }

  /**
   * S005: An EXISTS path endpoint is either:
   *  - Anonymous typed  (:Cache)    — alias=null → no binding required
   *  - Anonymous        ()          — alias=null, type=null → no binding required
   *  - Bound alias      (srv)       — alias="srv" must be in allBound
   *  - Typed bound      (srv:Server) — alias="srv" must be in allBound
   *
   * NEW aliases introduced inside EXISTS are NOT added to the binding set
   * (EXISTS is a subquery, not a binding context).
   */
  private checkExistsEndpoint(
    node: NodePatternNode,
    bindings: BindingSets,
    rule: RuleNode,
    diags: SemanticDiagnostic[],
  ): void {
    if (node.alias === null) return; // anonymous node — no binding required

    // alias present but no type → it's a reference to an existing bound variable
    // alias present with type   → it's also a reference (srv:Server)
    // Either way, it must already be bound
    if (!bindings.allBound.has(node.alias)) {
      diags.push(this.diag(
        SemanticDiagnosticCode.EXISTS_ENDPOINT_UNBOUND,
        `EXISTS path endpoint '${node.alias}' is not a bound variable`,
        rule.name, rule.line, rule.column,
      ));
    }
  }

  // ---------------------------------------------------------------------------
  // Comparison expression checks — S001, S003, S004, S008
  // ---------------------------------------------------------------------------

  private checkComparison(
    expr: ComparisonExpr,
    bindings: BindingSets,
    rule: RuleNode,
    diags: SemanticDiagnostic[],
  ): void {
    this.checkExpression(expr.left, bindings, rule, diags);
    this.checkExpression(expr.right, bindings, rule, diags);
  }

  private checkExpression(
    expr: Expression,
    bindings: BindingSets,
    rule: RuleNode,
    diags: SemanticDiagnostic[],
  ): void {
    switch (expr.kind) {
      case "PropertyAccess":
        // srv.cpu → "srv" must be bound
        if (!bindings.allBound.has(expr.variable)) {
          diags.push(this.diag(
            SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE,
            `Unbound variable '${expr.variable}' in WHERE clause`,
            rule.name, rule.line, rule.column,
          ));
        }
        break;

      case "Identifier":
        // Could be a bound alias or a SIMULATE variable — both are valid
        if (!bindings.allBound.has(expr.name) && !bindings.simVars.has(expr.name)) {
          diags.push(this.diag(
            SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE,
            `Unbound variable '${expr.name}' in WHERE clause`,
            rule.name, rule.line, rule.column,
          ));
        }
        break;

      case "Literal":
        // Always valid — no variable reference
        break;

      case "FunctionCall":
        this.checkFunctionCall(expr, bindings, rule, diags);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Function call checks — S003, S004, S008
  // ---------------------------------------------------------------------------

  private checkFunctionCall(
    fn: FunctionCallNode,
    bindings: BindingSets,
    rule: RuleNode,
    diags: SemanticDiagnostic[],
  ): void {
    // S004 — DEGREE argument must be a bound alias
    if (fn.name === "DEGREE") {
      if (!bindings.allBound.has(fn.argument)) {
        diags.push(this.diag(
          SemanticDiagnosticCode.DEGREE_UNBOUND_ARGUMENT,
          `DEGREE argument must be a bound variable, '${fn.argument}' is not bound`,
          rule.name, rule.line, rule.column,
        ));
      }
      return; // DEGREE does not have BY or property
    }

    // S008 — SUM/AVG/MIN/MAX must use a property accessor: SUM(var.prop)
    if (
      (fn.name === "SUM" || fn.name === "AVG" ||
       fn.name === "MIN" || fn.name === "MAX") &&
      fn.property === null
    ) {
      diags.push(this.diag(
        SemanticDiagnosticCode.AGGREGATE_MISSING_PROPERTY,
        `Aggregate function requires a property accessor: ${fn.name}(${fn.argument}.prop)`,
        rule.name, rule.line, rule.column,
      ));
    }

    // S001 — The argument variable must be bound
    if (!bindings.allBound.has(fn.argument)) {
      diags.push(this.diag(
        SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE,
        `Unbound variable '${fn.argument}' in WHERE clause`,
        rule.name, rule.line, rule.column,
      ));
    }

    // S003 — BY anchor must be bound in MATCH, not OPTIONAL
    if (fn.groupBy !== null) {
      if (!bindings.matchBound.has(fn.groupBy)) {
        if (bindings.optionalBound.has(fn.groupBy)) {
          diags.push(this.diag(
            SemanticDiagnosticCode.BY_ANCHOR_NOT_IN_MATCH,
            `BY anchor '${fn.groupBy}' must be bound in MATCH, not OPTIONAL`,
            rule.name, rule.line, rule.column,
          ));
        } else {
          diags.push(this.diag(
            SemanticDiagnosticCode.BY_ANCHOR_NOT_IN_MATCH,
            `BY anchor '${fn.groupBy}' is not a bound variable`,
            rule.name, rule.line, rule.column,
          ));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private diag(
    code: SemanticDiagnosticCode,
    message: string,
    ruleName: string,
    line: number,
    column: number,
  ): SemanticDiagnostic {
    return { code, message, ruleName, line, column };
  }
}
