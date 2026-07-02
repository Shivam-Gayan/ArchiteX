import type { Request, Response } from "express";
import type { RuleEngine } from "../../engine/contracts/RuleEngine";
import { validateAndNormaliseGraph } from "../../graph/validation/graphValidator";
import { ArchitectureGraph } from "../../graph/models/ArchitectureGraph";
import { buildError } from "../middleware/errorHandler";
import { ErrorCode } from "../../shared/errorCodes";
import { isValidRuleCategory } from "../../shared/ruleCategories";
import type { ValidateResponseDto, BySeverityDto } from "../dto/validate.dto";
import type { Violation } from "../../engine/contracts/RuleEngine";

/**
 * POST /api/v1/validate — ApiContract.md §4
 *
 * Pipeline:
 * 1. Validate graph shape → 422 if invalid
 * 2. Build ArchitectureGraph (GraphContext implementation)
 * 3. Validate simulation values → 422 if non-numbers present
 * 4. Pass to RuleEngine.evaluate()
 * 5. Return 200 with violations + meta
 *
 * Note: violations are NOT HTTP errors. A graph with 20 violations returns 200.
 */
export class ValidateController {
  constructor(private readonly engine: RuleEngine) {}

  handle = async (req: Request, res: Response): Promise<void> => {
    const startMs = Date.now();

    // Engine readiness check → 503
    if (!this.engine.isReady()) {
      res.status(503).json(
        buildError(
          ErrorCode.ENGINE_NOT_READY,
          "The rule engine is still initialising. Please retry in a moment."
        )
      );
      return;
    }

    const body = req.body as {
      graph?: { nodes?: unknown; edges?: unknown };
      simulation?: unknown;
      ruleFilter?: unknown;
    };

    const rawGraph = body.graph ?? {};

    // Step 1: Validate and normalise the graph
    const graphResult = validateAndNormaliseGraph(
      rawGraph.nodes,
      rawGraph.edges
    );

    if (!graphResult.success) {
      res.status(422).json(
        buildError(
          ErrorCode.GRAPH_VALIDATION_FAILED,
          "The graph contains invalid fields that cannot be processed.",
          graphResult.errors
        )
      );
      return;
    }

    // Step 2: Validate simulation values (must all be numbers per spec §4)
    const rawSimulation = body.simulation;
    let simulationOverrides: Record<string, number> | null = null;

    if (rawSimulation !== null && rawSimulation !== undefined) {
      if (typeof rawSimulation !== "object" || Array.isArray(rawSimulation)) {
        res.status(422).json(
          buildError(
            ErrorCode.GRAPH_VALIDATION_FAILED,
            "The graph contains invalid fields that cannot be processed.",
            [{ field: "simulation", issue: "simulation must be an object" }]
          )
        );
        return;
      }

      const simErrors: { field: string; issue: string; value: unknown }[] = [];
      simulationOverrides = {};
      for (const [key, val] of Object.entries(rawSimulation)) {
        if (typeof val !== "number") {
          simErrors.push({
            field: `simulation.${key}`,
            issue: "Simulation values must be numbers",
            value: val,
          });
        } else {
          simulationOverrides[key] = val;
        }
      }

      if (simErrors.length > 0) {
        res.status(422).json(
          buildError(
            ErrorCode.GRAPH_VALIDATION_FAILED,
            "The graph contains invalid fields that cannot be processed.",
            simErrors
          )
        );
        return;
      }
    }

    // Step 3: Parse ruleFilter
    const rawFilter = body.ruleFilter as
      | { categories?: unknown; excludeRules?: unknown }
      | null
      | undefined;

    let categories: string[] | null = null;
    let excludeRules: string[] | null = null;

    if (rawFilter != null) {
      if (Array.isArray(rawFilter.categories)) {
        const invalidCats = rawFilter.categories.filter(
          (c) => typeof c !== "string" || !isValidRuleCategory(c)
        );
        if (invalidCats.length > 0) {
          res.status(422).json(
            buildError(
              ErrorCode.GRAPH_VALIDATION_FAILED,
              "The graph contains invalid fields that cannot be processed.",
              [
                {
                  field: "ruleFilter.categories",
                  issue: "Invalid category. Must be one of: security, availability, performance, scalability",
                  value: invalidCats,
                },
              ]
            )
          );
          return;
        }
        categories = rawFilter.categories as string[];
      }

      if (Array.isArray(rawFilter.excludeRules)) {
        excludeRules = rawFilter.excludeRules.filter(
          (r): r is string => typeof r === "string"
        );
      }
    }

    // Step 4: Build GraphContext and evaluate
    const graph = new ArchitectureGraph(graphResult.nodes, graphResult.edges);

    let violations: Violation[];
    try {
      violations = this.engine.evaluate(graph, {
        simulationOverrides,
        categories,
        excludeRules,
      });
    } catch (err) {
      console.error("[ValidateController] Engine evaluation error:", err);
      res.status(500).json(
        buildError(
          ErrorCode.ENGINE_ERROR,
          "Rule evaluation failed unexpectedly. Please try again."
        )
      );
      return;
    }

    // Step 5: Build response
    const bySeverity: BySeverityDto = { ERROR: 0, WARNING: 0, INFO: 0, HINT: 0 };
    for (const v of violations) {
      bySeverity[v.severity]++;
    }

    const allRules = this.engine.getLoadedRules();
    const applicableRules = allRules.filter((r) => {
      if (categories && !categories.includes(r.category)) return false;
      if (excludeRules && excludeRules.includes(r.name)) return false;
      return true;
    });

    const response: ValidateResponseDto = {
      violations,
      meta: {
        totalViolations: violations.length,
        bySeverity,
        rulesEvaluated: applicableRules.length,
        nodesEvaluated: graphResult.nodes.length,
        edgesEvaluated: graphResult.edges.length,
        durationMs: Date.now() - startMs,
      },
    };

    res.status(200).json(response);
  };
}
