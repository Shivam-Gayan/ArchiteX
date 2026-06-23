/**
 * Internal graph domain model for a node.
 *
 * Derived from ApiContract.md §2 (NodeObject) and ArchQL_v3_2.md §2 (Nodes).
 *
 * NOTE: This is NOT the API DTO. This is the internal representation
 * after the incoming request has been validated and normalised.
 *
 * - `label` is always present here (defaulted to `type` if absent in request).
 * - `properties` is always an object (defaulted to {} if absent in request).
 * - Canvas position (x, y) is NOT included — spec §1: "Canvas position data
 *   is frontend-only state and is not sent to the backend."
 */
export interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}
