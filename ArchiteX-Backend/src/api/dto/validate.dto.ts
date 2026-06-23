import type { SeverityLevel } from "../../shared/severity";

/**
 * DTOs for POST /validate — ApiContract.md §4.
 *
 * These are the WIRE shapes. They are NOT domain models.
 * Validation and normalisation happen in graphValidator.ts.
 */

// ---- Request ----

export interface NodeObjectDto {
  id: string;
  type: string;
  label?: string;
  properties?: Record<string, string | number | boolean>;
}

export interface EdgeObjectDto {
  id: string;
  type?: string;
  sourceId: string;
  targetId: string;
  properties?: Record<string, string | number | boolean>;
}

export interface RuleFilterDto {
  categories: string[] | null;
  excludeRules: string[] | null;
}

export interface ValidateRequestDto {
  graph: {
    nodes: NodeObjectDto[];
    edges: EdgeObjectDto[];
  };
  simulation: Record<string, number> | null;
  ruleFilter: RuleFilterDto | null;
}

// ---- Response ----

export interface ViolationDto {
  ruleName: string;
  severity: SeverityLevel;
  message: string;
  highlightedNodeIds: string[];
  ruleFile: string;
}

export interface BySeverityDto {
  ERROR: number;
  WARNING: number;
  INFO: number;
  HINT: number;
}

export interface ValidateResponseDto {
  violations: ViolationDto[];
  meta: {
    totalViolations: number;
    bySeverity: BySeverityDto;
    rulesEvaluated: number;
    nodesEvaluated: number;
    edgesEvaluated: number;
    durationMs: number;
  };
}
