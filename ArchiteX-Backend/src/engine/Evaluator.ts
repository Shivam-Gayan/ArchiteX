/**
 * Evaluator — ArchQL WHERE clause evaluator and Violation builder.
 *
 * Consumes the BindingEnvs produced by the Matcher for a single rule and:
 *  1. Resolves SIMULATE values — frontend overrides take priority, rule defaults are fallback.
 *  2. Evaluates the WHERE clause (BooleanExpr tree) against each binding.
 *  3. Applies YIELD ONCE deduplication.
 *  4. Builds Violation objects for every binding that passes the WHERE filter.
 *
 * Aggregate functions (COUNT BY, SUM BY, DEGREE):
 *   COUNT/SUM/AVG/MIN/MAX BY anchor — group all bindings by the anchor node id,
 *   compute the aggregate per group, then test the comparison per group.
 *   DEGREE — looks up graph degree for the bound node.
 *
 * EXISTS forms:
 *   variable  — EXISTS(auth)        → true iff auth is not null
 *   property  — EXISTS(srv.cpu)     → true iff getNodeProperty returns non-undefined
 *   path      — EXISTS((a)->(:T))   → true iff the Matcher finds ≥1 match
 *
 * Spec refs: ArchQL_v3_2.md §9 (SIMULATE), §10 (Aggregates), §11 (EXISTS),
 *            §16 (YIELD), §18 EBNF.
 */

import type { GraphContext } from "../graph/contracts/GraphContext";
import type { GraphNode } from "../graph/models/GraphNode";
import type { GraphEdge } from "../graph/models/GraphEdge";
import type { BindingEnv, BoundValue } from "./BindingEnv";
import type {
  RuleNode,
  BooleanExpr,
  Expression,
  ComparisonExpr,
  ExistsExprNode,
  NotExpr,
  AndExpr,
  OrExpr,
  FunctionCallNode,
  SimulateBinding,
  Literal,
  NodePatternNode,
  EdgePatternNode,
} from "../compiler/ast/RuleAST";
import type { Violation } from "./contracts/RuleEngine";
import { Matcher } from "./Matcher";

// ---------------------------------------------------------------------------
// Resolved simulation context for a single rule evaluation
// ---------------------------------------------------------------------------
type SimContext = Map<string, number | string | boolean>;

export class Evaluator {
  private readonly matcher = new Matcher();

  /**
   * Evaluates all binding environments for a single rule, applying the WHERE
   * clause and building Violations for every passing binding.
   *
   * @param rule              The compiled rule AST.
   * @param bindings          All BindingEnvs from the Matcher (MATCH + OPTIONAL merged).
   * @param graph             The graph context (used for aggregate + EXISTS evaluation).
   * @param simOverrides      Frontend simulation overrides (numbers only per API contract).
   */
  evaluate(
    rule: RuleNode,
    bindings: BindingEnv[],
    graph: GraphContext,
    simOverrides: Record<string, number> | null
  ): Violation[] {
    if (bindings.length === 0) return [];

    // Build simulation context: frontend overrides > rule defaults
    const simCtx = this.buildSimContext(rule.simulateBindings, simOverrides);

    // Handle aggregate WHERE clauses separately (they operate over the full
    // binding set rather than per-row)
    if (rule.whereClause && this.isAggregateClause(rule.whereClause)) {
      return this.evaluateAggregate(rule, bindings, graph, simCtx);
    }

    // Standard per-row evaluation
    const violations: Violation[] = [];
    let yieldedOnce = false;

    for (const env of bindings) {
      // WHERE clause — null means "always yield"
      if (rule.whereClause !== null) {
        const passes = this.evalBool(rule.whereClause, env, graph, simCtx);
        if (!passes) continue;
      }

      if (rule.yieldClause.once) {
        if (yieldedOnce) continue;
        yieldedOnce = true;
      }

      violations.push(this.buildViolation(rule, env));
    }

    return violations;
  }

  // ---------------------------------------------------------------------------
  // Simulation context
  // ---------------------------------------------------------------------------

  private buildSimContext(
    bindings: ReadonlyArray<SimulateBinding>,
    overrides: Record<string, number> | null
  ): SimContext {
    const ctx: SimContext = new Map();
    // Rule defaults first
    for (const b of bindings) {
      ctx.set(b.variable, this.literalToJs(b.value));
    }
    // Frontend overrides win (always numbers per ApiContract §4)
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        ctx.set(k, v);
      }
    }
    return ctx;
  }

  private literalToJs(lit: Literal): number | string | boolean {
    switch (lit.kind) {
      case "number":  return lit.value;
      case "string":  return lit.value;
      case "boolean": return lit.value;
      case "list":    return 0; // list literals not used in SIMULATE
    }
  }

  // ---------------------------------------------------------------------------
  // Aggregate evaluation
  // COUNT(srv) BY lb < 2 → group bindings by lb.id, count srv per group,
  // yield for each group where the aggregate fails the condition.
  // ---------------------------------------------------------------------------

  private isAggregateClause(expr: BooleanExpr): boolean {
    if (expr.kind === "Comparison") {
      return expr.left.kind === "FunctionCall" || expr.right.kind === "FunctionCall";
    }
    if (expr.kind === "And" || expr.kind === "Or") {
      return this.isAggregateClause(expr.left) || this.isAggregateClause(expr.right);
    }
    if (expr.kind === "Not") return this.isAggregateClause(expr.operand);
    return false;
  }

  private evaluateAggregate(
    rule: RuleNode,
    bindings: BindingEnv[],
    graph: GraphContext,
    simCtx: SimContext
  ): Violation[] {
    // Find all FunctionCall nodes in the WHERE clause
    const fnNode = this.findFirstFunctionCall(rule.whereClause!);
    if (!fnNode) return [];

    // DEGREE is not a group aggregate — treat it per-row
    if (fnNode.name === "DEGREE") {
      const violations: Violation[] = [];
      let yieldedOnce = false;
      for (const env of bindings) {
        const passes = this.evalBool(rule.whereClause!, env, graph, simCtx);
        if (!passes) continue;
        if (rule.yieldClause.once) {
          if (yieldedOnce) continue;
          yieldedOnce = true;
        }
        violations.push(this.buildViolation(rule, env));
      }
      return violations;
    }

    const groupBy = fnNode.groupBy;
    const violations: Violation[] = [];

    if (groupBy) {
      // Group bindings by the anchor node id
      const groups = new Map<string, BindingEnv[]>();
      for (const env of bindings) {
        const anchor = env.get(groupBy);
        if (!anchor || !("id" in anchor)) continue;
        const key = (anchor as GraphNode).id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(env);
      }

      for (const [, group] of groups) {
        // Evaluate WHERE using the group context
        const aggEnv = this.buildAggEnv(group, fnNode, graph);
        const passes = this.evalBool(rule.whereClause!, aggEnv, graph, simCtx);
        if (!passes) continue;

        // Yield for every binding in this group (so all offending nodes are highlighted)
        let yieldedOnce = false;
        for (const env of group) {
          if (rule.yieldClause.once) {
            if (yieldedOnce) continue;
            yieldedOnce = true;
          }
          violations.push(this.buildViolation(rule, env));
        }
      }
    } else {
      // Global aggregate (no BY) — evaluate once across all bindings
      const aggEnv = this.buildAggEnv(bindings, fnNode, graph);
      const passes = this.evalBool(rule.whereClause!, aggEnv, graph, simCtx);
      if (!passes) return [];

      let yieldedOnce = false;
      for (const env of bindings) {
        if (rule.yieldClause.once) {
          if (yieldedOnce) continue;
          yieldedOnce = true;
        }
        violations.push(this.buildViolation(rule, env));
      }
    }

    return violations;
  }

  /**
   * Builds a synthetic BindingEnv that contains the pre-computed aggregate
   * result under the function name as a "virtual" variable, so evalBool
   * can resolve it as a number when it hits the FunctionCall node.
   */
  private buildAggEnv(
    group: BindingEnv[],
    fn: FunctionCallNode,
    graph: GraphContext
  ): BindingEnv {
    // Use the first env as a base (provides anchor bindings)
    const base = new Map(group[0]);

    // Compute the aggregate value
    let aggValue: number;
    switch (fn.name) {
      case "COUNT":
        aggValue = group.length;
        break;
      case "SUM":
        aggValue = group.reduce((acc, env) => {
          const val = this.resolvePropertyValue(env, fn.argument, fn.property!, graph);
          return acc + (typeof val === "number" ? val : 0);
        }, 0);
        break;
      case "AVG": {
        const sum = group.reduce((acc, env) => {
          const val = this.resolvePropertyValue(env, fn.argument, fn.property!, graph);
          return acc + (typeof val === "number" ? val : 0);
        }, 0);
        aggValue = group.length > 0 ? sum / group.length : 0;
        break;
      }
      case "MIN": {
        const vals = group.map((env) => {
          const v = this.resolvePropertyValue(env, fn.argument, fn.property!, graph);
          return typeof v === "number" ? v : Infinity;
        });
        aggValue = Math.min(...vals);
        break;
      }
      case "MAX": {
        const vals = group.map((env) => {
          const v = this.resolvePropertyValue(env, fn.argument, fn.property!, graph);
          return typeof v === "number" ? v : -Infinity;
        });
        aggValue = Math.max(...vals);
        break;
      }
      default:
        aggValue = 0;
    }

    // Store the aggregate under a synthetic key so evalExpression can find it
    base.set(`__agg__${fn.name}__${fn.argument}`, { id: "__agg__", type: "__agg__", label: "", properties: { __value: aggValue } } as unknown as GraphNode);
    return base;
  }

  private findFirstFunctionCall(expr: BooleanExpr): FunctionCallNode | null {
    switch (expr.kind) {
      case "Comparison":
        if (expr.left.kind === "FunctionCall") return expr.left;
        if (expr.right.kind === "FunctionCall") return expr.right as FunctionCallNode;
        return null;
      case "And": return this.findFirstFunctionCall(expr.left) ?? this.findFirstFunctionCall(expr.right);
      case "Or":  return this.findFirstFunctionCall(expr.left) ?? this.findFirstFunctionCall(expr.right);
      case "Not": return this.findFirstFunctionCall(expr.operand);
      default:    return null;
    }
  }

  private resolvePropertyValue(
    env: BindingEnv,
    varName: string,
    propName: string,
    graph: GraphContext
  ): string | number | boolean | undefined {
    const bound = env.get(varName);
    if (!bound || !("id" in bound)) return undefined;
    return graph.getNodeProperty((bound as GraphNode).id, propName);
  }

  // ---------------------------------------------------------------------------
  // Boolean expression evaluation
  // ---------------------------------------------------------------------------

  evalBool(
    expr: BooleanExpr,
    env: BindingEnv,
    graph: GraphContext,
    simCtx: SimContext
  ): boolean {
    switch (expr.kind) {
      case "And":
        return (
          this.evalBool((expr as AndExpr).left, env, graph, simCtx) &&
          this.evalBool((expr as AndExpr).right, env, graph, simCtx)
        );
      case "Or":
        return (
          this.evalBool((expr as OrExpr).left, env, graph, simCtx) ||
          this.evalBool((expr as OrExpr).right, env, graph, simCtx)
        );
      case "Not":
        return !this.evalBool((expr as NotExpr).operand, env, graph, simCtx);
      case "ExistsExpr":
        return this.evalExists(expr, env, graph, simCtx);
      case "Comparison":
        return this.evalComparison(expr, env, graph, simCtx);
    }
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------

  private evalComparison(
    expr: ComparisonExpr,
    env: BindingEnv,
    graph: GraphContext,
    simCtx: SimContext
  ): boolean {
    const left  = this.evalExpression(expr.left,  env, graph, simCtx);
    const right = this.evalExpression(expr.right, env, graph, simCtx);

    if (left === undefined || right === undefined) return false;

    switch (expr.operator) {
      case "=":        return left === right;
      case "!=":       return left !== right;
      case "<":        return (left as number) <  (right as number);
      case ">":        return (left as number) >  (right as number);
      case "<=":       return (left as number) <= (right as number);
      case ">=":       return (left as number) >= (right as number);
      case "IN":
        return Array.isArray(right)
          ? (right as unknown[]).includes(left)
          : false;
      case "CONTAINS":
        return typeof left === "string" && typeof right === "string"
          ? left.includes(right)
          : false;
    }
  }

  // ---------------------------------------------------------------------------
  // Expression resolution
  // ---------------------------------------------------------------------------

  private evalExpression(
    expr: Expression,
    env: BindingEnv,
    graph: GraphContext,
    simCtx: SimContext
  ): number | string | boolean | undefined {
    switch (expr.kind) {
      case "Literal":
        return this.literalToJs(expr.value);

      case "Identifier": {
        // Check simulation context first
        if (simCtx.has(expr.name)) return simCtx.get(expr.name);
        // Then try to resolve as a plain bound variable (shouldn't happen in valid rules,
        // but fail gracefully)
        return undefined;
      }

      case "PropertyAccess": {
        const bound = env.get(expr.variable);
        if (!bound) return undefined;
        if ("sourceId" in bound) {
          // GraphEdge
          return graph.getEdgeProperty((bound as GraphEdge).id, expr.property);
        }
        // GraphNode
        return graph.getNodeProperty((bound as GraphNode).id, expr.property);
      }

      case "FunctionCall":
        return this.evalFunction(expr, env, graph, simCtx);
    }
  }

  private evalFunction(
    fn: FunctionCallNode,
    env: BindingEnv,
    graph: GraphContext,
    simCtx: SimContext
  ): number | undefined {
    // Aggregate result — check if it was pre-computed and stored in the env
    const aggKey = `__agg__${fn.name}__${fn.argument}`;
    if (env.has(aggKey)) {
      const agg = env.get(aggKey) as GraphNode;
      return agg.properties.__value as number;
    }

    // DEGREE — resolved live per binding
    if (fn.name === "DEGREE") {
      const bound = env.get(fn.argument);
      if (!bound || !("id" in bound)) return undefined;
      return graph.getDegree((bound as GraphNode).id);
    }

    // Other aggregates without pre-computation shouldn't reach here in valid rules,
    // but handle gracefully
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // EXISTS
  // ---------------------------------------------------------------------------

  private evalExists(
    expr: ExistsExprNode,
    env: BindingEnv,
    graph: GraphContext,
    simCtx: SimContext
  ): boolean {
    switch (expr.form) {
      case "variable": {
        // EXISTS(auth) — true iff auth is bound and non-null
        if (!expr.variable) return false;
        const val = env.get(expr.variable);
        return val !== null && val !== undefined;
      }

      case "property": {
        // EXISTS(srv.cpu) — true iff the property is defined on the node
        if (!expr.variable || !expr.propertyName) return false;
        const bound = env.get(expr.variable);
        if (!bound || !("id" in bound)) return false;
        const propVal = graph.getNodeProperty((bound as GraphNode).id, expr.propertyName);
        return propVal !== undefined;
      }

      case "path": {
        // EXISTS((from) -> (:Type)) — true iff the Matcher finds ≥1 match
        if (!expr.path) return false;
        return this.evalExistsPath(expr.path.from, expr.path.edge, expr.path.to, env, graph);
      }
    }
  }

  private evalExistsPath(
    fromPat: NodePatternNode,
    edgePat: EdgePatternNode | null,
    toPat: NodePatternNode | null,
    env: BindingEnv,
    graph: GraphContext
  ): boolean {
    // Build a mini-pattern for the Matcher
    const elements: (NodePatternNode | EdgePatternNode)[] = [fromPat];
    if (edgePat) elements.push(edgePat);
    if (toPat)   elements.push(toPat);

    const miniPattern = { kind: "Pattern" as const, elements };
    // Pass the current env as seed so bound aliases are resolved as anchors
    const matches = this.matcher.match(miniPattern, graph, env);
    return matches.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Violation builder
  // ---------------------------------------------------------------------------

  private buildViolation(rule: RuleNode, env: BindingEnv): Violation {
    const highlightedNodeIds: string[] = [];

    for (const varName of rule.yieldClause.withVars) {
      const bound = env.get(varName);
      if (!bound) continue;
      // Only highlight nodes (not edges or null OPTIONAL bindings)
      if ("id" in bound && "type" in bound) {
        highlightedNodeIds.push((bound as GraphNode).id);
      }
    }

    return {
      ruleName:           rule.name,
      severity:           rule.severity,
      message:            rule.yieldClause.message,
      highlightedNodeIds,
      ruleFile:           rule.sourceFile,
    };
  }
}
