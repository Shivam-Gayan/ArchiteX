/**
 * Internal graph domain model for a directed edge.
 *
 * Derived from ApiContract.md §2 (EdgeObject) and ArchQL_v3_2.md §4 (Edge Types).
 *
 * NOTE: This is NOT the API DTO.
 * - `type` is always present here (defaulted to "Traffic" if absent in request
 *   per ApiContract §2: "type defaults to 'Traffic' if absent").
 * - `properties` is always an object (defaulted to {} if absent).
 */
export interface GraphEdge {
  readonly id: string;
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}
