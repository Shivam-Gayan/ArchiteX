/**
 * ArchQLEngine — the real RuleEngine implementation.
 *
 * This is the final piece of the compiler pipeline. It:
 *  1. Loads .arch rule files via the RuleLoader (Lexer → Parser → SemanticAnalyser)
 *  2. Serves rule metadata for GET /rules
 *  3. Evaluates rules against an ArchitectureGraph per POST /validate
 *
 * Replace MockRuleEngine with this class in src/index.ts at startup.
 *
 * Spec refs: ArchQL_v3_2.md §8 (Engine Lifecycle), §9 (Simulate),
 *            ApiContract.md §4 (validate), §7 (rules), §8 (health)
 */

import type {
  RuleEngine,
  RuleMetadata,
  Violation,
  EvaluationOptions,
} from "./contracts/RuleEngine";
import type { GraphContext } from "../graph/contracts/GraphContext";
import type { RuleNode } from "../compiler/ast/RuleAST";
import { RuleLoader } from "../compiler/loader/RuleLoader";
import { Matcher } from "./Matcher";
import { Evaluator } from "./Evaluator";

// ---------------------------------------------------------------------------
// Category inference
// Maps the source filename to a category for the GET /rules response.
// Convention: the .arch file basename determines the category.
// ---------------------------------------------------------------------------
const FILE_CATEGORY_MAP: Record<string, string> = {
  "availability_rules.arch": "availability",
  "performance_rules.arch":  "performance",
  "security_rules.arch":     "security",
};

function inferCategory(sourceFile: string): string {
  return FILE_CATEGORY_MAP[sourceFile] ?? "general";
}

export class ArchQLEngine implements RuleEngine {
  private rules: RuleNode[] = [];
  private ready = false;

  private readonly loader   = new RuleLoader();
  private readonly matcher  = new Matcher();
  private readonly evaluator = new Evaluator();

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async loadRules(filePaths: string[]): Promise<void> {
    const result = await this.loader.load(filePaths);

    if (result.diagnostics.length > 0) {
      // Log all issues but only fatal if there are zero valid rules and files
      for (const d of result.diagnostics) {
        console.warn(`[ArchQLEngine] ${d.phase.toUpperCase()} ${d.code} in ${d.sourceFile}:${d.line} — ${d.message}`);
      }
    }

    this.rules = result.rules;
    this.ready = true;

    console.log(`[ArchQLEngine] Loaded ${this.rules.length} rule(s) from ${filePaths.length} file(s).`);
    if (result.diagnostics.length > 0) {
      console.warn(`[ArchQLEngine] ${result.diagnostics.length} diagnostic(s) emitted during load.`);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  // ---------------------------------------------------------------------------
  // GET /rules
  // ---------------------------------------------------------------------------

  getLoadedRules(): RuleMetadata[] {
    return this.rules.map((rule): RuleMetadata => ({
      name:          rule.name,
      severity:      rule.severity,
      category:      inferCategory(rule.sourceFile),
      file:          rule.sourceFile,
      yieldMessage:  rule.yieldClause.message,
      hasSimulation: rule.simulateBindings.length > 0,
    }));
  }

  // ---------------------------------------------------------------------------
  // POST /validate
  // ---------------------------------------------------------------------------

  evaluate(graph: GraphContext, options: EvaluationOptions): Violation[] {
    if (!this.ready) {
      throw new Error("ArchQLEngine is not ready. Call loadRules() first.");
    }

    const allViolations: Violation[] = [];

    for (const rule of this.rules) {
      // Apply ruleFilter.categories
      if (options.categories) {
        const category = inferCategory(rule.sourceFile);
        if (!options.categories.includes(category)) continue;
      }

      // Apply ruleFilter.excludeRules
      if (options.excludeRules?.includes(rule.name)) continue;

      // Step 1: Match MATCH clause — find all seed bindings
      const matchBindings = this.matcher.match(rule.matchClause, graph);
      if (matchBindings.length === 0) continue;

      // Step 2: Extend with each OPTIONAL clause
      let bindings = matchBindings;
      for (const optPat of rule.optionalClauses) {
        const extended: typeof bindings = [];
        for (const env of bindings) {
          const optMatches = this.matcher.match(optPat, graph, env);
          if (optMatches.length === 0) {
            // OPTIONAL did not match — keep the env but set optional aliases to null
            const nullEnv = new Map(env);
            for (const el of optPat.elements) {
              if (el.kind === "NodePattern" && el.alias) nullEnv.set(el.alias, null);
              if (el.kind === "EdgePattern" && el.alias) nullEnv.set(el.alias, null);
            }
            extended.push(nullEnv);
          } else {
            extended.push(...optMatches);
          }
        }
        bindings = extended;
      }

      // Step 3: Evaluate WHERE clause and build Violations
      const ruleViolations = this.evaluator.evaluate(
        rule,
        bindings,
        graph,
        options.simulationOverrides
      );

      allViolations.push(...ruleViolations);
    }

    return allViolations;
  }
}
