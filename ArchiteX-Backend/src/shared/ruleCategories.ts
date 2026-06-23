/**
 * Rule categories as defined in ApiContract.md §4 (RuleCategory enum).
 *
 * Used in:
 * - POST /validate → ruleFilter.categories
 * - GET /rules → query param ?category=
 */
export const RULE_CATEGORIES = [
  "security",
  "availability",
  "performance",
  "scalability",
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY_SET = new Set<string>(RULE_CATEGORIES);

export function isValidRuleCategory(value: string): value is RuleCategory {
  return RULE_CATEGORY_SET.has(value);
}
