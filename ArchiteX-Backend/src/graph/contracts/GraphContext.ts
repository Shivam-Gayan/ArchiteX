import type { GraphNode } from "../models/GraphNode";
import type { GraphEdge } from "../models/GraphEdge";

/**
 * GraphContext — The ONLY interface through which the compiler
 * accesses graph data.
 *
 * This contract is jointly owned by Dev A (implementor) and Dev C (consumer).
 * Dev C's compiler MUST NOT import GraphNode, GraphEdge, or any internal
 * graph implementation directly.
 *
 * Design principles:
 * - Read-only: the compiler never mutates the graph.
 * - All methods return stable value objects (no internal mutable references).
 * - Type strings are raw strings so the compiler remains agnostic to NodeType enum.
 *
 * Spec references:
 * - ArchQL_v3_2.md §2 (Graph Model — Nodes, Edges, Properties)
 * - ArchQL_v3_2.md §12–16 (Pattern Matching, Traversal)
 */
export interface GraphContext {
  /**
   * Returns all nodes in the graph.
   * Used by the compiler when it needs to scan all nodes (e.g. COUNT globally).
   */
  getNodes(): ReadonlyArray<GraphNode>;

  /**
   * Returns all nodes whose `type` field exactly matches the given string.
   * Used for MATCH (x:Type) patterns.
   * Type matching is case-sensitive per ArchQL_v3_2.md §2.
   */
  getNodesByType(type: string): ReadonlyArray<GraphNode>;

  /**
   * Returns a single node by its id, or undefined if not found.
   * Used when the compiler resolves a bound variable to a concrete node.
   */
  getNode(id: string): GraphNode | undefined;

  /**
   * Returns all outgoing edges from the given node.
   * Optionally filtered by edge type.
   * Used for directed edge patterns: (a) -> (b), (a) -[:Type]-> (b).
   */
  getOutgoingEdges(nodeId: string, edgeType?: string): ReadonlyArray<GraphEdge>;

  /**
   * Returns all incoming edges to the given node.
   * Optionally filtered by edge type.
   * Used for anchored path checks like EXISTS((:LB) -> (srv)).
   */
  getIncomingEdges(nodeId: string, edgeType?: string): ReadonlyArray<GraphEdge>;

  /**
   * Returns all edges in the graph.
   * Used for undirected edge matching (--) and global traversals.
   */
  getEdges(): ReadonlyArray<GraphEdge>;

  /**
   * Returns the value of a property on a node, or undefined if not set.
   * Used by the compiler to evaluate expressions like srv.instances.
   * Returns undefined (not null) when the property is absent — callers must
   * handle the missing-property case explicitly.
   */
  getNodeProperty(
    nodeId: string,
    property: string
  ): string | number | boolean | undefined;

  /**
   * Returns the value of a property on an edge, or undefined if not set.
   * Used for edge property filters: -[e:Writes {encrypted:false}]->.
   */
  getEdgeProperty(
    edgeId: string,
    property: string
  ): string | number | boolean | undefined;

  /**
   * Returns the total number of outbound edges from a node.
   * Used to implement the DEGREE(var) function in ArchQL_v3_2.md §10.
   * "Returns the number of direct outbound edges from a node, regardless of type."
   */
  getDegree(nodeId: string): number;
}
