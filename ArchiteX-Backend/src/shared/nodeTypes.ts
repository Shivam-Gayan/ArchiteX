/**
 * Valid node types as defined in ApiContract.md §2 (NodeType enum)
 * and ArchQL_v3_2.md §2 (Supported Node Types).
 *
 * These are the ONLY valid values for NodeObject.type.
 * Derived from spec. Do not add values not present in the specification.
 */
export const NODE_TYPES = [
  "Client",
  "APIGateway",
  "LoadBalancer",
  "Server",
  "Worker",
  "Queue",
  "MessageBroker",
  "StreamProcessor",
  "Cache",
  "Database",
  "SearchEngine",
  "ObjectStorage",
  "CDN",
  "AuthService",
  "RateLimiter",
  "CircuitBreaker",
  "ServiceMesh",
  "Monitoring",
  "Logging",
  "Tracing",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_TYPE_SET = new Set<string>(NODE_TYPES);

export function isValidNodeType(value: string): value is NodeType {
  return NODE_TYPE_SET.has(value);
}
