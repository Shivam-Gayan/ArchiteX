import type { RuleEngine, RuleMetadata, Violation, EvaluationOptions } from "../contracts/RuleEngine";
import type { GraphContext } from "../../graph/contracts/GraphContext";

/**
 * MockRuleEngine — A stub implementation of RuleEngine.
 *
 * PURPOSE: Allows Dev A to build, wire, and test all API endpoints
 * without waiting for Dev C's compiler implementation.
 *
 * Replace this with the real ArchQLEngine once Dev C's compiler
 * is integrated (Phase 3 of the project plan).
 *
 * This stub:
 * - Always reports as ready
 * - Returns a small set of fake rule metadata (for GET /rules testing)
 * - Returns an empty violations array (for POST /validate smoke testing)
 */
export class MockRuleEngine implements RuleEngine {
  private ready = false;

  private readonly stubRules: RuleMetadata[] = [
    {
      name: "Single Server Behind Load Balancer",
      severity: "ERROR",
      category: "availability",
      file: "availability_rules.arch",
      yieldMessage: "Load balancer has fewer than 2 servers — single point of failure",
      hasSimulation: false,
    },
    {
      name: "Unencrypted Database Connection",
      severity: "ERROR",
      category: "security",
      file: "security_rules.arch",
      yieldMessage: "Database write connection is not encrypted",
      hasSimulation: false,
    },
    {
      name: "Server CPU Exceeds Threshold",
      severity: "WARNING",
      category: "performance",
      file: "performance_rules.arch",
      yieldMessage: "Server CPU exceeds acceptable threshold",
      hasSimulation: true,
    },
  ];

  async loadRules(_filePaths: string[]): Promise<void> {
    // Stub: no real loading
    this.ready = true;
  }

  getLoadedRules(): RuleMetadata[] {
    return this.stubRules;
  }

  evaluate(
    _graph: GraphContext,
    _options: EvaluationOptions
  ): Violation[] {
    // Stub: returns empty until real engine is connected
    return [];
  }

  isReady(): boolean {
    return this.ready;
  }
}
