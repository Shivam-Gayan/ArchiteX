/**
 * Valid edge types as defined in ApiContract.md §2 (EdgeType enum)
 * and ArchQL_v3_2.md §4 (Edge Types).
 *
 * These are the ONLY valid values for EdgeObject.type.
 * If type is absent in a request, it defaults to "Traffic" per ApiContract §2.
 */
export const EDGE_TYPES = [
  "Traffic",
  "Reads",
  "Writes",
  "Calls",
  "ReplicatesTo",
  "Publishes",
  "Consumes",
  "Streams",
  "Proxies",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const EDGE_TYPE_SET = new Set<string>(EDGE_TYPES);

export const DEFAULT_EDGE_TYPE: EdgeType = "Traffic";

export function isValidEdgeType(value: string): value is EdgeType {
  return EDGE_TYPE_SET.has(value);
}
