import type { Request, Response } from "express";
import type { RuleEngine } from "../../engine/contracts/RuleEngine";
import { isValidRuleCategory } from "../../shared/ruleCategories";
import { SEVERITY_LEVELS } from "../../shared/severity";
import type { RulesResponseDto } from "../dto/rules.dto";

/**
 * GET /api/v1/rules — ApiContract.md §7
 *
 * Supports optional query parameters:
 * - ?category=security|availability|performance|scalability
 * - ?severity=ERROR|WARNING|INFO|HINT
 *
 * Returns all loaded rules filtered by the given params.
 * Unrecognised filter values are silently ignored (spec does not mandate 422 here).
 */
export class RulesController {
  constructor(private readonly engine: RuleEngine) {}

  handle = (_req: Request, res: Response): void => {
    let rules = this.engine.getLoadedRules();

    const categoryParam = _req.query["category"] as string | undefined;
    const severityParam = _req.query["severity"] as string | undefined;

    if (categoryParam && isValidRuleCategory(categoryParam)) {
      rules = rules.filter((r) => r.category === categoryParam);
    }

    if (severityParam && SEVERITY_LEVELS.includes(severityParam as any)) {
      rules = rules.filter((r) => r.severity === severityParam);
    }

    const response: RulesResponseDto = {
      rules,
      total: rules.length,
    };

    res.status(200).json(response);
  };
}
