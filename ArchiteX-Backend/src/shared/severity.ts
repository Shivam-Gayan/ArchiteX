/**
 * Severity levels as defined in ApiContract.md §2 (SeverityLevel enum)
 * and ArchQL_v3_2.md §7.
 *
 * Used in ViolationObject and RuleMetadata.
 */
export const SEVERITY_LEVELS = ["ERROR", "WARNING", "INFO", "HINT"] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
