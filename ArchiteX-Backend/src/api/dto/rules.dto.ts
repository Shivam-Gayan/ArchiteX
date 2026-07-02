import type { SeverityLevel } from "../../shared/severity";

/**
 * DTOs for GET /rules — ApiContract.md §7.
 */
export interface RuleDto {
  name: string;
  severity: SeverityLevel;
  category: string;
  file: string;
  yieldMessage: string;
  hasSimulation: boolean;
}

export interface RulesResponseDto {
  rules: RuleDto[];
  total: number;
}

/**
 * DTOs for GET /health — ApiContract.md §8.
 */
export interface HealthResponseDto {
  status: "ok" | "degraded" | "unavailable";
  engineReady: boolean;
  rulesLoaded: number;
  uptime: number;
}
